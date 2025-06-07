from dataclasses import dataclass
from pathlib import Path
import os
import logging
from logging.handlers import RotatingFileHandler

@dataclass
class Config:
    significant_terms_suffix: str = '.txt'
    summary_suffix: str = '.txt'
    condensed_suffix: str = '.txt'
    condensed_dir: Path = Path('guidance/condensed')
    significant_terms_dir: Path = Path('guidance/significant_terms')
    summary_dir: Path = Path('guidance/summary')
    max_chunk_tokens: int = 4000
    
    def __post_init__(self):
        self.summary_list_file = self.summary_dir / 'list_of_summaries.json'
        self.significant_terms_list_file = self.significant_terms_dir / 'list_of_significant_terms.json'
        
        # Ensure directories exist
        for directory in [self.condensed_dir, self.significant_terms_dir, self.summary_dir]:
            directory.mkdir(parents=True, exist_ok=True)
        
        # Configure logging
        self._setup_logging()
    
    def _setup_logging(self):
        """Configure logging for all Python scripts"""
        # Create logs directory if it doesn't exist
        log_dir = Path('logs')
        log_dir.mkdir(exist_ok=True)
        
        # Configure root logger
        root_logger = logging.getLogger()
        root_logger.setLevel(logging.INFO)
        
        # Remove existing handlers
        for handler in root_logger.handlers[:]:
            root_logger.removeHandler(handler)
        
        # Create formatters
        file_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_formatter = logging.Formatter(
            '%(levelname)s - %(message)s'
        )
        
        # File handler with rotation
        file_handler = RotatingFileHandler(
            log_dir / 'python.log',
            maxBytes=5*1024*1024,  # 5MB
            backupCount=5
        )
        file_handler.setFormatter(file_formatter)
        file_handler.setLevel(logging.INFO)
        
        # Console handler
        console_handler = logging.StreamHandler()
        console_handler.setFormatter(console_formatter)
        console_handler.setLevel(logging.INFO)
        
        # Add handlers to root logger
        root_logger.addHandler(file_handler)
        root_logger.addHandler(console_handler)
        
        # Set logging level based on environment
        if os.getenv('DEBUG'):
            root_logger.setLevel(logging.DEBUG)
            file_handler.setLevel(logging.DEBUG)
            console_handler.setLevel(logging.DEBUG) 