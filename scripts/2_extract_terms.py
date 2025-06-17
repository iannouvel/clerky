# DISABLED SCRIPT - NO LONGER EXTRACTING SIGNIFICANT TERMS
# This script is no longer used as we've simplified the workflow to only convert PDFs to text
# The workflow now skips: condensed text → significant terms → summary generation

from pathlib import Path
import logging
from shared.config import Config
from shared.openai_client import OpenAIClient
from shared.text_processor import TextProcessor
from shared.file_manager import FileManager

def extract_terms():
    """
    DISABLED: This function is no longer called by any workflow.
    We've simplified to only convert PDFs to plain text.
    """
    config = Config()
    openai_client = OpenAIClient()
    text_processor = TextProcessor(config, openai_client)
    file_manager = FileManager(config)
    
    for condensed_file in config.condensed_dir.glob(f"*{config.condensed_suffix}"):
        terms_file = config.significant_terms_dir / f"{condensed_file.stem}{config.significant_terms_suffix}"
        if not terms_file.exists():
            condensed_text = file_manager.read_text(condensed_file)
            if condensed_text:
                terms = text_processor.extract_significant_terms(condensed_text)
                if terms:
                    file_manager.save_text(terms, terms_file)
    
    file_manager.generate_significant_terms_list()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("WARNING: This script is disabled. We no longer extract significant terms.")
    # extract_terms()  # Commented out 