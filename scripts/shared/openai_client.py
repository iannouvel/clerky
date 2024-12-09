import os
import requests
import logging
import tiktoken
from typing import Optional, List, Dict

class OpenAIClient:
    def __init__(self):
        self.api_key = self._load_credentials()
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")

    def _load_credentials(self) -> str:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OpenAI API key not found in environment variables")
        return api_key

    def chat_completion(self, messages: List[Dict[str, str]], max_tokens: int = 1000) -> Optional[str]:
        """
        Send a chat completion request to OpenAI API
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens for the response
        """
        total_tokens = sum(len(self.encoding.encode(msg['content'])) for msg in messages)
        if total_tokens > 6000:
            logging.warning("Token count exceeds maximum limit")
            return None

        body = {
            "model": "gpt-3.5-turbo",
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.5
        }

        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {self.api_key}'
            },
            json=body
        )

        if response.status_code != 200:
            error_details = response.json()
            logging.error(f"OpenAI API error: {error_details.get('error')}")
            return None

        return response.json()['choices'][0]['message']['content']

    def _make_request(self, prompt: str, max_tokens: int = 1000) -> Optional[str]:
        """Legacy method for backward compatibility"""
        return self.chat_completion([{"role": "user", "content": prompt}], max_tokens) 