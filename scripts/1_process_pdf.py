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
    logging.info(f"Found {len(all_pdfs)} PDFs in guidance directory")
    
    # Write the current list of PDFs
    with open(guidelines_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(all_pdfs) + '\n')
    logging.info(f"Updated guidelines list with {len(all_pdfs)} PDFs")

def process_new_pdfs():
    config = Config()
    pdf_processor = PDFProcessor(config)
    file_manager = FileManager(config)
    
    logging.info("Starting to process new PDFs")
    logging.info(f"Looking for PDFs in: {Path('guidance').absolute()}")
    
    new_pdfs = []
    pdf_files = list(Path('guidance').glob('*.pdf'))
    logging.info(f"Found {len(pdf_files)} PDF files")
    
    for pdf_file in pdf_files:
        logging.info(f"Processing PDF: {pdf_file}")
        condensed_path = config.condensed_dir / f"{pdf_file.stem}{config.condensed_suffix}"
        logging.info(f"Checking for existing condensed file: {condensed_path}")
        
        if not condensed_path.exists():
            logging.info(f"Extracting text from {pdf_file}")
            text = pdf_processor.extract_text(pdf_file)
            if text:
                logging.info(f"Successfully extracted {len(text)} characters from {pdf_file}")
                # Save the full extracted text (not condensed) - just clean it up
                cleaned_text = pdf_processor.clean_extracted_text(text)
                if cleaned_text:
                    logging.info(f"Successfully cleaned text for {pdf_file}")
                    file_manager.save_text(
                        cleaned_text,
                        config.condensed_dir / f"{pdf_file.stem}{config.condensed_suffix}"
                    )
                    new_pdfs.append(pdf_file)
                else:
                    logging.warning(f"Failed to clean text for {pdf_file}")
            else:
                logging.warning(f"No text extracted from {pdf_file}")
        else:
            logging.info(f"Skipping {pdf_file} as condensed version already exists")
    
    # Update the list of guidelines with all current PDFs
    logging.info(f"Processed {len(new_pdfs)} new PDFs")
    update_guidelines_list(new_pdfs)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    process_new_pdfs() 