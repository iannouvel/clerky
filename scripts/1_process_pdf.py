from pathlib import Path
import logging
from typing import Optional, List
from shared.config import Config
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
    """
    SIMPLIFIED VERSION: Only converts PDFs to plain text files.
    No longer creates condensed text, significant terms, or summaries.
    """
    config = Config()
    pdf_processor = PDFProcessor(config)
    file_manager = FileManager(config)
    
    logging.info("Starting to process new PDFs - SIMPLIFIED VERSION (PDF to text only)")
    logging.info(f"Looking for PDFs in: {Path('guidance').absolute()}")
    
    new_pdfs = []
    pdf_files = list(Path('guidance').glob('*.pdf'))
    logging.info(f"Found {len(pdf_files)} PDF files")
    
    for pdf_file in pdf_files:
        logging.info(f"Processing PDF: {pdf_file}")
        
        # Save text file directly in guidance folder, not in condensed subfolder
        text_file_path = Path('guidance') / f"{pdf_file.stem}.txt"
        logging.info(f"Checking for existing text file: {text_file_path}")
        
        if not text_file_path.exists():
            logging.info(f"Extracting text from {pdf_file}")
            text = pdf_processor.extract_text(pdf_file)
            if text:
                logging.info(f"Successfully extracted {len(text)} characters from {pdf_file}")
                # Save the full extracted text as plain text (no AI processing)
                cleaned_text = pdf_processor.clean_extracted_text(text)
                if cleaned_text:
                    logging.info(f"Successfully cleaned text for {pdf_file}")
                    # Save directly in guidance folder as .txt file
                    with open(text_file_path, 'w', encoding='utf-8') as f:
                        f.write(cleaned_text)
                    logging.info(f"Saved text file: {text_file_path}")
                    new_pdfs.append(pdf_file)
                else:
                    logging.warning(f"Failed to clean text for {pdf_file}")
            else:
                logging.warning(f"No text extracted from {pdf_file}")
        else:
            logging.info(f"Skipping {pdf_file} as text version already exists: {text_file_path}")
    
    # Update the list of guidelines with all current PDFs
    logging.info(f"Processed {len(new_pdfs)} new PDFs")
    update_guidelines_list(new_pdfs)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
    process_new_pdfs() 