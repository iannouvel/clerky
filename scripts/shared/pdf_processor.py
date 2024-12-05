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

    def condense_text(self, text: str) -> Optional[str]:
        chunks = self.split_into_chunks(text)
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