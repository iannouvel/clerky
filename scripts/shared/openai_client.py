import os
import requests
import logging
import tiktoken
from typing import Optional

class OpenAIClient:
    def __init__(self):
        self.api_key = self._load_credentials()
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")

    def _load_credentials(self) -> str:
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise ValueError("OpenAI API key not found in environment variables")
        return api_key

    def _make_request(self, prompt: str, max_tokens: int = 1000) -> Optional[str]:
        tokens = self.encoding.encode(prompt)
        if len(tokens) > 6000:
            logging.warning("Token count exceeds maximum limit")
            return None

        body = {
            "model": "gpt-3.5-turbo",
            "messages": [{"role": "user", "content": prompt}],
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
            raise Exception(f"OpenAI API error: {error_details.get('error')}")

        return response.json()['choices'][0]['message']['content'] 