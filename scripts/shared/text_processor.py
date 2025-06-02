import logging
import os
from typing import Optional
from .config import Config
from .openai_client import OpenAIClient


class TextProcessor:
    def __init__(self, config: Config, openai_client: OpenAIClient):
        self.config = config
        self.openai_client = openai_client
        self.provider = os.getenv('PREFERRED_AI_PROVIDER', 'OpenAI')
        logging.info(f"TextProcessor initialized with preferred provider: {self.provider}")
        
        # Set default models based on provider
        if self.provider == 'OpenAI':
            self.default_model = 'gpt-3.5-turbo'
        else:  # DeepSeek
            self.default_model = 'deepseek-chat'

    def extract_significant_terms(self, text: str) -> Optional[str]:
        """
        Extract significant clinical terms from text using the AI provider
        """
        prompt = (
            "From the following clinical guideline text, extract the most clinically significant terms "
            "and keywords that are critical for understanding the guidance:\n\n"
            f"{text}"
        )
        
        messages = [{"role": "user", "content": prompt}]
        return self.openai_client.chat_completion(
            messages=messages,
            max_tokens=500,
            model=self.default_model,
            provider=self.provider
        )

    def generate_summary(self, text):
        """Generate a concise summary of the given text, handling large texts by chunking if needed."""
        try:
            # Calculate approximate tokens
            tokens = len(text) / 4  # Rough estimate of tokens
            
            if tokens > 3000:  # If text is too long, split and summarize in parts
                chunks = self._split_text(text, max_tokens=3000)
                summaries = []
                
                for chunk in chunks:
                    response = self.openai_client.chat_completion(
                        messages=[
                            {"role": "system", "content": "Create a clear, concise summary of the clinical guideline (approximately 200 words). Focus on the key recommendations, important clinical points, and critical management steps. Use clear medical terminology and maintain accuracy. Do not include references or citations."},
                            {"role": "user", "content": chunk}
                        ],
                        model=self.default_model,
                        provider=self.provider
                    )
                    if response:
                        summaries.append(response)
                
                # Combine summaries
                combined_summary = " ".join(summaries)
                
                # Final consolidation if needed
                if len(combined_summary.split()) > 200:
                    return self.generate_summary(combined_summary)  # Recursive call for final consolidation
                return combined_summary
                
            else:
                # Original behavior for shorter texts
                response = self.openai_client.chat_completion(
                    messages=[
                        {"role": "system", "content": "Create a clear, concise summary of the clinical guideline (approximately 200 words). Focus on the key recommendations, important clinical points, and critical management steps. Use clear medical terminology and maintain accuracy. Do not include references or citations."},
                        {"role": "user", "content": text}
                    ],
                    model=self.default_model,
                    provider=self.provider
                )
                return response
        except Exception as e:
            logging.warning(f"Error generating summary: {str(e)}")
            return None

    def _split_text(self, text, max_tokens=3000):
        """Split text into chunks of approximately max_tokens."""
        words = text.split()
        chunks = []
        current_chunk = []
        current_length = 0
        
        for word in words:
            word_length = len(word) / 4  # Rough token estimate
            if current_length + word_length > max_tokens:
                chunks.append(" ".join(current_chunk))
                current_chunk = [word]
                current_length = word_length
            else:
                current_chunk.append(word)
                current_length += word_length
        
        if current_chunk:
            chunks.append(" ".join(current_chunk))
        
        return chunks 