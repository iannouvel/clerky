from pathlib import Path
import logging
from typing import Optional
from shared.config import Config
from shared.openai_client import OpenAIClient
from shared.pdf_processor import PDFProcessor
from shared.file_manager import FileManager

def process_new_pdfs():
    config = Config()
    pdf_processor = PDFProcessor(config)
    file_manager = FileManager(config)
    
    for pdf_file in Path('guidance').glob('*.pdf'):
        if not (config.condensed_dir / f"{pdf_file.stem}{config.condensed_suffix}").exists():
            text = pdf_processor.extract_text(pdf_file)
            if text:
                condensed = pdf_processor.condense_text(text)
                if condensed:
                    file_manager.save_text(
                        condensed,
                        config.condensed_dir / f"{pdf_file.stem}{config.condensed_suffix}"
                    )

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    process_new_pdfs() 