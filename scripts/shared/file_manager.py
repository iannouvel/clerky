import json
import logging
from pathlib import Path
from typing import Optional
from .config import Config

class FileManager:
    def __init__(self, config: Config):
        self.config = config

    def save_text(self, text: str, file_path: Path) -> None:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(text)
            logging.info(f"Saved text to {file_path}")
        except Exception as e:
            logging.error(f"Error saving to {file_path}: {e}")

    def read_text(self, file_path: Path) -> Optional[str]:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return f.read()
        except Exception as e:
            logging.error(f"Error reading from {file_path}: {e}")
            return None

    def generate_summary_list(self) -> None:
        summaries = {}
        
        for file_path in self.config.summary_dir.glob(f"*{self.config.summary_suffix}"):
            content = self.read_text(file_path)
            if content and content.strip():
                summaries[file_path.name] = content
            
        self.save_text(
            json.dumps(summaries, indent=4, ensure_ascii=False),
            self.config.summary_list_file
        )

    def generate_significant_terms_list(self) -> None:
        terms_data = {}
        
        for file_path in self.config.significant_terms_dir.glob(f"*{self.config.significant_terms_suffix}"):
            content = self.read_text(file_path)
            if content:
                terms_data[file_path.name] = content
            
        self.save_text(
            json.dumps(terms_data, indent=4),
            self.config.significant_terms_list_file
        ) 