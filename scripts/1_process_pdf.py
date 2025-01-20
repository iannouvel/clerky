from pathlib import Path
import logging
from typing import Optional
from shared.config import Config
from shared.openai_client import OpenAIClient
from shared.pdf_processor import PDFProcessor
from shared.file_manager import FileManager

def update_guidelines_list(new_pdfs: list[Path]):
    """Update the list_of_guidelines.txt file with any new PDFs."""
    guidance_dir = Path('guidance')
    guidelines_file = guidance_dir / 'list_of_guidelines.txt'
    
    # Ensure guidance directory exists
    guidance_dir.mkdir(exist_ok=True)
    
    # Read existing guidelines
    existing_guidelines = set()
    if guidelines_file.exists():
        with open(guidelines_file, 'r', encoding='utf-8') as f:
            existing_guidelines = {line.strip() for line in f if line.strip()}
    
    # Add new PDFs to the set
    all_guidelines = existing_guidelines.union({pdf.name for pdf in new_pdfs})
    
    # Write back the sorted list
    with open(guidelines_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(all_guidelines)) + '\n')

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
    
    # Update the list of guidelines if we found any new PDFs
    if new_pdfs:
        update_guidelines_list(new_pdfs)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    process_new_pdfs() 