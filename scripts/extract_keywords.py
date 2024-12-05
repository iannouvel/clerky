import os
import json
import requests
import logging
from dataclasses import dataclass
from typing import List, Dict, Optional
from pathlib import Path
from PyPDF2 import PdfReader
import tiktoken
from rapidfuzz import fuzz, process

# Configuration class using dataclass
@dataclass
class Config:
    significant_terms_suffix: str = '.txt'
    summary_suffix: str = '.txt'
    condensed_suffix: str = '.txt'
    condensed_dir: Path = Path('guidance/condensed')
    significant_terms_dir: Path = Path('guidance/significant_terms')
    summary_dir: Path = Path('guidance/summary')
    max_chunk_tokens: int = 4000
    
    def __post_init__(self):
        self.summary_list_file = self.summary_dir / 'list_of_summaries.json'
        self.significant_terms_list_file = self.significant_terms_dir / 'list_of_significant_terms.json'
        
        # Ensure directories exist
        for directory in [self.condensed_dir, self.significant_terms_dir, self.summary_dir]:
            directory.mkdir(parents=True, exist_ok=True)

class OpenAIClient:
    def __init__(self):
        self.api_key = self._load_credentials()
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")

    def _load_credentials(self) -> str:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OpenAI API key not found in environment variables")
        return api_key

    def _make_request(self, prompt: str, max_tokens: int = 1000) -> Optional[str]:
        tokens = self.encoding.encode(prompt)
        if len(tokens) > 6000:
            logging.warning("Token count exceeds maximum limit")
            return None

        body = {
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "temperature": 0.5
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self.api_key}'
            },
            json=body
        )

        if response.status_code != 200:
            error_details = response.json()
            raise Exception(f"OpenAI API error: {error_details.get('error')}")

        return response.json()['choices'][0]['message']['content']

class PDFProcessor:
    def __init__(self, config: Config):
        self.config = config
        self.openai_client = OpenAIClient()

    def extract_text(self, file_path: Path) -> str:
        try:
            reader = PdfReader(file_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text()
            logging.info(f"Extracted {len(text)} characters from PDF")
            return text
        except Exception as e:
            logging.error(f"Error reading PDF {file_path}: {e}")
            return ""

    def split_into_chunks(self, text: str) -> List[str]:
        tokens = self.openai_client.encoding.encode(text)
        chunks = []
        
        for i in range(0, len(tokens), self.config.max_chunk_tokens):
            chunk = tokens[i:i + self.config.max_chunk_tokens]
            chunks.append(self.openai_client.encoding.decode(chunk))
        
        logging.info(f"Split text into {len(chunks)} chunks")
        return chunks

class TextProcessor:
    def __init__(self, config: Config, openai_client: OpenAIClient):
        self.config = config
        self.openai_client = openai_client

    def condense_text(self, text: str) -> Optional[str]:
        chunks = PDFProcessor(self.config).split_into_chunks(text)
        condensed_chunks = []

        for chunk in chunks:
            prompt = (
                "With the attached text from a clinical guideline, "
                "please return a condensed version of the text which removes clinically insignificant text, "
                "please remove all the scientific references, if there are any, at the end of the text as they do not need to be in the condensed output, "
                "please do not change the clinically significant text at all.\n\n"
                f"{chunk}"
            )
            
            try:
                condensed = self.openai_client._make_request(prompt)
                if condensed:
                    condensed_chunks.append(condensed)
            except Exception as e:
                logging.error(f"Error condensing chunk: {e}")
                continue

        return "\n\n".join(condensed_chunks) if condensed_chunks else None

    def extract_significant_terms(self, text: str) -> Optional[str]:
        prompt = (
            "From the following clinical guideline text, extract the most clinically significant terms "
            "and keywords that are critical for understanding the guidance:\n\n"
            f"{text}"
        )
        return self.openai_client._make_request(prompt, max_tokens=500)

    def generate_summary(self, text: str) -> Optional[str]:
        prompt = (
            "Please provide a 100-word summary of the following clinical guideline:\n\n"
            f"{text}"
        )
        return self.openai_client._make_request(prompt, max_tokens=200)

class FileManager:
    def __init__(self, config: Config):
        self.config = config

    def save_text(self, text: str, file_path: Path) -> None:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(text)
            logging.info(f"Saved text to {file_path}")
        except Exception as e:
            logging.error(f"Error saving to {file_path}: {e}")

    def read_text(self, file_path: Path) -> Optional[str]:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            logging.error(f"Error reading from {file_path}: {e}")
            return None

    def generate_summary_list(self) -> None:
        summaries = {}
        
        for file_path in self.config.summary_dir.glob(f"*{self.config.summary_suffix}"):
            content = self.read_text(file_path)
            if content and content.strip():
                summaries[file_path.name] = content
            
        self.save_text(
            json.dumps(summaries, indent=4, ensure_ascii=False),
            self.config.summary_list_file
        )

    def generate_significant_terms_list(self) -> None:
        terms_data = {}
        
        for file_path in self.config.significant_terms_dir.glob(f"*{self.config.significant_terms_suffix}"):
            content = self.read_text(file_path)
            if content:
                terms_data[file_path.name] = content
            
        self.save_text(
            json.dumps(terms_data, indent=4),
            self.config.significant_terms_list_file
        )

class DocumentProcessor:
    def __init__(self):
        self.config = Config()
        self.openai_client = OpenAIClient()
        self.text_processor = TextProcessor(self.config, self.openai_client)
        self.file_manager = FileManager(self.config)

    def process_pdf(self, pdf_path: Path) -> bool:
        base_name = pdf_path.stem
        
        # Define output paths
        condensed_path = self.config.condensed_dir / f"{base_name}{self.config.condensed_suffix}"
        terms_path = self.config.significant_terms_dir / f"{base_name}{self.config.significant_terms_suffix}"
        summary_path = self.config.summary_dir / f"{base_name}{self.config.summary_suffix}"

        processed = False
        condensed_text = None

        # Process condensed text
        if not condensed_path.exists():
            extracted_text = PDFProcessor(self.config).extract_text(pdf_path)
            if extracted_text:
                condensed_text = self.text_processor.condense_text(extracted_text)
                if condensed_text:
                    self.file_manager.save_text(condensed_text, condensed_path)
                    processed = True

        # Process significant terms
        if not terms_path.exists():
            if not condensed_text:
                condensed_text = self.file_manager.read_text(condensed_path)
            if condensed_text:
                terms = self.text_processor.extract_significant_terms(condensed_text)
                if terms:
                    self.file_manager.save_text(terms, terms_path)
                    processed = True

        # Process summary
        if not summary_path.exists():
            if not condensed_text:
                condensed_text = self.file_manager.read_text(condensed_path)
            if condensed_text:
                summary = self.text_processor.generate_summary(condensed_text)
                if summary:
                    self.file_manager.save_text(summary, summary_path)
                    processed = True

        return processed

    def process_directory(self, directory: Path) -> bool:
        if not directory.is_dir():
            logging.error(f"Directory {directory} does not exist")
            return False

        processed = False
        for pdf_file in directory.glob('*.pdf'):
            if self.process_pdf(pdf_file):
                processed = True

        if processed:
            self.file_manager.generate_summary_list()
            self.file_manager.generate_significant_terms_list()

        return processed

def main():
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    
    processor = DocumentProcessor()
    processor.process_directory(Path('guidance'))

if __name__ == "__main__":
    main()
