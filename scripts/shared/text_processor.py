import logging
from typing import Optional
from .config import Config
from .openai_client import OpenAIClient

class TextProcessor:
    def __init__(self, config: Config, openai_client: OpenAIClient):
        self.config = config
        self.openai_client = openai_client

    def extract_significant_terms(self, text: str) -> Optional[str]:
        prompt = (
            "From the following clinical guideline text, extract the most clinically significant terms "
            "and keywords that are critical for understanding the guidance:\n\n"
            f"{text}"
        )
        return self.openai_client._make_request(prompt, max_tokens=500)

    def generate_summary(self, text: str) -> Optional[str]:
        prompt = (
            "Please provide a 100-word summary of the following clinical guideline:\n\n"
            f"{text}"
        )
        return self.openai_client._make_request(prompt, max_tokens=200) 