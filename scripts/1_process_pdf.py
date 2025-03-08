from pathlib import Path
import logging
from typing import Optional, List
from shared.config import Config
from shared.openai_client import OpenAIClient
from shared.pdf_processor import PDFProcessor
from shared.file_manager import FileManager

def update_guidelines_list(new_pdfs: List[Path]):
    """Update the list_of_guidelines.txt file with any new PDFs."""
    guidance_dir = Path('guidance')
    guidelines_file = guidance_dir / 'list_of_guidelines.txt'
    
    # Ensure guidance directory exists
    guidance_dir.mkdir(exist_ok=True)
    
    # Get all current PDFs in the guidance directory
    all_pdfs = sorted([pdf.name for pdf in guidance_dir.glob('*.pdf')])
    
    # Write the current list of PDFs
    with open(guidelines_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(all_pdfs) + '\n')

def process_new_pdfs():
    config = Config()
    pdf_processor = PDFProcessor(config)
    file_manager = FileManager(config)
    
    new_pdfs = []
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
                    new_pdfs.append(pdf_file)
    
    # Update the list of guidelines with all current PDFs
    update_guidelines_list(new_pdfs)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    process_new_pdfs() 