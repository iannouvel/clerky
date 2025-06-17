# DISABLED SCRIPT - NO LONGER GENERATING SUMMARIES
# This script is no longer used as we've simplified the workflow to only convert PDFs to text
# The workflow now skips: condensed text → significant terms → summary generation

from pathlib import Path
import logging
from shared.config import Config
from shared.openai_client import OpenAIClient
from shared.text_processor import TextProcessor
from shared.file_manager import FileManager

def generate_summaries():
    """
    DISABLED: This function is no longer called by any workflow.
    We've simplified to only convert PDFs to plain text.
    """
    config = Config()
    openai_client = OpenAIClient()
    text_processor = TextProcessor(config, openai_client)
    file_manager = FileManager(config)
    
    for condensed_file in config.condensed_dir.glob(f"*{config.condensed_suffix}"):
        summary_file = config.summary_dir / f"{condensed_file.stem}{config.summary_suffix}"
        if not summary_file.exists():
            condensed_text = file_manager.read_text(condensed_file)
            if condensed_text:
                summary = text_processor.generate_summary(condensed_text)
                if summary:
                    file_manager.save_text(summary, summary_file)
    
    file_manager.generate_summary_list()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    print("WARNING: This script is disabled. We no longer generate summaries.")
    # generate_summaries()  # Commented out 