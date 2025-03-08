import logging
from typing import List, Optional
from pathlib import Path
from PyPDF2 import PdfReader
from .config import Config
from .openai_client import OpenAIClient

class PDFProcessor:
    def __init__(self, config: Config):
        self.config = config
        self.openai_client = OpenAIClient()

    def extract_text(self, file_path: Path) -> str:
        try:
            logging.info(f"Opening PDF file: {file_path}")
            reader = PdfReader(file_path)
            logging.info(f"Successfully opened PDF with {len(reader.pages)} pages")
            
            text = ""
            for i, page in enumerate(reader.pages):
                try:
                    page_text = page.extract_text()
                    text += page_text
                    logging.info(f"Extracted {len(page_text)} characters from page {i+1}")
                except Exception as e:
                    logging.error(f"Error extracting text from page {i+1}: {e}")
            
            logging.info(f"Total extracted {len(text)} characters from PDF")
            return text
        except Exception as e:
            logging.error(f"Error reading PDF {file_path}: {str(e)}")
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
                    condensed = self.openai_client._make_request(prompt)
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