from dataclasses import dataclass
from pathlib import Path

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