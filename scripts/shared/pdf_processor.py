import logging
from typing import List, Optional
from pathlib import Path
from PyPDF2 import PdfReader
from pdfminer.high_level import extract_text as pdfminer_extract
from pdf2image import convert_from_path
import pytesseract
import tempfile
import os
from .config import Config
from .openai_client import OpenAIClient

class PDFProcessor:
    def __init__(self, config: Config):
        self.config = config
        self.openai_client = OpenAIClient()
        self.provider = os.getenv('PREFERRED_AI_PROVIDER', 'OpenAI')
        logging.info(f"PDFProcessor initialized with preferred provider: {self.provider}")

    def extract_text_pypdf2(self, file_path: Path) -> str:
        try:
            reader = PdfReader(file_path)
            text = ""
            for i, page in enumerate(reader.pages):
                try:
                    page_text = page.extract_text()
                    text += page_text
                    logging.info(f"PyPDF2: Extracted {len(page_text)} characters from page {i+1}")
                except Exception as e:
                    logging.error(f"PyPDF2: Error extracting text from page {i+1}: {e}")
            return text
        except Exception as e:
            logging.error(f"PyPDF2: Error reading PDF {file_path}: {str(e)}")
            return ""

    def extract_text_pdfminer(self, file_path: Path) -> str:
        try:
            text = pdfminer_extract(str(file_path))
            logging.info(f"PDFMiner: Extracted {len(text)} characters")
            return text
        except Exception as e:
            logging.error(f"PDFMiner: Error extracting text: {str(e)}")
            return ""

    def extract_text_ocr(self, file_path: Path) -> str:
        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                # Convert PDF to images
                images = convert_from_path(file_path)
                text = ""
                
                for i, image in enumerate(images):
                    # Save image temporarily
                    image_path = os.path.join(temp_dir, f'page_{i}.png')
                    image.save(image_path, 'PNG')
                    
                    # Extract text using OCR
                    page_text = pytesseract.image_to_string(image_path)
                    text += page_text
                    logging.info(f"OCR: Extracted {len(page_text)} characters from page {i+1}")
                
                return text
        except Exception as e:
            logging.error(f"OCR: Error extracting text: {str(e)}")
            return ""

    def extract_text(self, file_path: Path) -> str:
        logging.info(f"Opening PDF file: {file_path}")
        
        # Try PyPDF2 first
        text = self.extract_text_pypdf2(file_path)
        if len(text.strip()) > 0:
            logging.info(f"Successfully extracted {len(text)} characters using PyPDF2")
            return text
            
        # If PyPDF2 fails, try PDFMiner
        logging.info("PyPDF2 failed, trying PDFMiner...")
        text = self.extract_text_pdfminer(file_path)
        if len(text.strip()) > 0:
            logging.info(f"Successfully extracted {len(text)} characters using PDFMiner")
            return text
            
        # If both fail, try OCR
        logging.info("PDFMiner failed, trying OCR...")
        text = self.extract_text_ocr(file_path)
        if len(text.strip()) > 0:
            logging.info(f"Successfully extracted {len(text)} characters using OCR")
            return text
            
        logging.error("All text extraction methods failed")
        return ""

    def split_into_chunks(self, text: str) -> List[str]:
        try:
            tokens = self.openai_client.encoding.encode(text)
            chunks = []
            
            for i in range(0, len(tokens), self.config.max_chunk_tokens):
                chunk = tokens[i:i + self.config.max_chunk_tokens]
                chunks.append(self.openai_client.encoding.decode(chunk))
            
            logging.info(f"Split text into {len(chunks)} chunks")
            return chunks
        except Exception as e:
            logging.error(f"Error splitting text into chunks: {e}")
            return []

    def condense_text(self, text: str) -> Optional[str]:
        try:
            chunks = self.split_into_chunks(text)
            if not chunks:
                logging.error("No chunks created from text")
                return None
                
            condensed_chunks = []

            # Choose model based on provider
            model = None
            if self.provider == 'OpenAI':
                model = 'gpt-3.5-turbo'
            elif self.provider == 'DeepSeek':
                model = 'deepseek-chat'
            
            logging.info(f"Using {self.provider} with model {model} for text condensation")

            for i, chunk in enumerate(chunks):
                logging.info(f"Processing chunk {i+1} of {len(chunks)}")
                prompt = (
                    "With the attached text from a clinical guideline, "
                    "please return a condensed version of the text which removes clinically insignificant text, "
                    "please remove all the scientific references, if there are any, at the end of the text as they do not need to be in the condensed output, "
                    "please do not change the clinically significant text at all.\n\n"
                    f"{chunk}"
                )
                
                try:
                    messages = [{"role": "user", "content": prompt}]
                    condensed = self.openai_client.chat_completion(
                        messages=messages,
                        model=model,
                        provider=self.provider
                    )
                    
                    if condensed:
                        logging.info(f"Successfully condensed chunk {i+1}")
                        condensed_chunks.append(condensed)
                    else:
                        logging.warning(f"No condensed text returned for chunk {i+1}")
                except Exception as e:
                    logging.error(f"Error condensing chunk {i+1}: {e}")
                    continue

            if not condensed_chunks:
                logging.error("No chunks were successfully condensed")
                return None

            result = "\n\n".join(condensed_chunks)
            logging.info(f"Successfully condensed text from {len(chunks)} chunks to {len(result)} characters")
            return result
            
        except Exception as e:
            logging.error(f"Error in condense_text: {e}")
            return None 