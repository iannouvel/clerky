import os
import requests
import logging
import tiktoken
import json
from typing import Optional, List, Dict
from datetime import datetime

class OpenAIClient:
    def __init__(self):
        self.api_key, self.deepseek_api_key = self._load_credentials()
        self.encoding = tiktoken.encoding_for_model("gpt-3.5-turbo")
        self.server_url = os.getenv('SERVER_URL', 'https://clerky-uzni.onrender.com')
        self.workflow_token = os.getenv('WORKFLOW_TOKEN')
        self.workflow_name = os.getenv('GITHUB_WORKFLOW', 'unknown')
        self.should_report_usage = bool(self.workflow_token and self.server_url)
        self.preferred_provider = os.getenv('PREFERRED_AI_PROVIDER', 'OpenAI')
        
        if self.should_report_usage:
            logging.info(f"Usage reporting is enabled for workflow: {self.workflow_name}")
        else:
            logging.warning("Usage reporting is disabled - either SERVER_URL or WORKFLOW_TOKEN is missing")
        
        logging.info(f"Preferred AI provider: {self.preferred_provider}")

    def _load_credentials(self) -> tuple:
        api_key = os.getenv('OPENAI_API_KEY')
        deepseek_api_key = os.getenv('DEEPSEEK_API_KEY')
        
        if not api_key and not deepseek_api_key:
            raise ValueError("No API keys found in environment variables. Need either OPENAI_API_KEY or DEEPSEEK_API_KEY")
        
        return api_key, deepseek_api_key

    def report_usage(self, usage: Dict, model: str, prompt: str = None, response: str = None, provider: str = None):
        """Report the token usage to the server"""
        if not self.should_report_usage:
            logging.warning("Skipping usage reporting - not configured properly")
            return False
            
        try:
            # Determine the provider if not explicitly provided
            if provider is None:
                if "gpt" in model:
                    provider = "OpenAI"
                elif "deepseek" in model:
                    provider = "DeepSeek"
                else:
                    provider = self.preferred_provider
            
            payload = {
                "workflow": self.workflow_name,
                "token_usage": usage,
                "model": model,
                "timestamp": datetime.now().isoformat(),
                "provider": provider
            }
            
            # Add optional fields if provided
            if prompt:
                payload["prompt"] = prompt[:1000]  # Truncate long prompts
                
            if response:
                payload["response"] = response[:1000]  # Truncate long responses
                
            logging.info(f"Reporting usage to {self.server_url}/log-workflow-ai-usage")
            
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.workflow_token}"
            }
            
            response = requests.post(
                f"{self.server_url}/log-workflow-ai-usage",
                headers=headers,
                json=payload,
                timeout=10  # Set a timeout to avoid hanging
            )
            
            if response.status_code == 200:
                logging.info(f"Successfully reported usage: {usage.get('total_tokens')} tokens")
                return True
            else:
                logging.error(f"Failed to report usage: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            logging.error(f"Error reporting usage: {str(e)}")
            return False

    def chat_completion(self, messages: List[Dict[str, str]], max_tokens: int = 1000, model: str = None, provider: str = None) -> Optional[str]:
        """
        Send a chat completion request to the specified AI provider API
        
        Args:
            messages: List of message dictionaries with 'role' and 'content'
            max_tokens: Maximum tokens for the response
            model: The model to use (defaults to provider-specific default if None)
            provider: The AI provider to use (defaults to preferred_provider if None)
        """
        # Determine which provider to use
        if provider is None:
            provider = self.preferred_provider
            
        # Set default model based on provider if not specified
        if model is None:
            if provider == "OpenAI":
                model = "gpt-3.5-turbo"
            else:  # DeepSeek
                model = "deepseek-chat"
        
        # Select API key based on provider
        api_key = self.api_key if provider == "OpenAI" else self.deepseek_api_key
        
        # Fallback if the chosen provider's API key isn't available
        if not api_key:
            alt_provider = "DeepSeek" if provider == "OpenAI" else "OpenAI"
            alt_key = self.deepseek_api_key if provider == "OpenAI" else self.api_key
            
            if alt_key:
                logging.warning(f"{provider} API key not found, falling back to {alt_provider}")
                provider = alt_provider
                api_key = alt_key
                model = "deepseek-chat" if provider == "DeepSeek" else "gpt-3.5-turbo"
            else:
                logging.error("No API keys available for any provider")
                return None
        
        # Count tokens before sending to avoid exceeding limits
        total_tokens = sum(len(self.encoding.encode(msg['content'])) for msg in messages)
        if total_tokens > 6000:
            logging.warning("Token count exceeds maximum limit")
            return None

        body = {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.5
        }

        try:
            # Set the API endpoint based on provider
            api_endpoint = 'https://api.openai.com/v1/chat/completions' if provider == "OpenAI" else 'https://api.deepseek.com/v1/chat/completions'
            
            logging.info(f"Sending request to {provider} API using model {model}")
            
            response = requests.post(
                api_endpoint,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {api_key}'
                },
                json=body
            )

            if response.status_code != 200:
                error_details = response.json()
                logging.error(f"{provider} API error: {error_details.get('error')}")
                return None
                
            response_json = response.json()
            content = response_json['choices'][0]['message']['content']
            
            # Extract token usage and report it
            if 'usage' in response_json:
                usage = response_json['usage']
                prompt_text = " | ".join([msg['content'][:50] + "..." for msg in messages])
                self.report_usage(usage, model, prompt_text, content, provider)
                
            return content
        except Exception as e:
            logging.error(f"Error in chat_completion: {str(e)}")
            return None

    def _make_request(self, prompt: str, max_tokens: int = 1000, model: str = None, provider: str = None) -> Optional[str]:
        """Legacy method for backward compatibility"""
        # Use the preferred provider if not specified
        if provider is None:
            provider = self.preferred_provider
            
        # Set default model based on provider if not specified
        if model is None:
            if provider == "OpenAI":
                model = "gpt-3.5-turbo"
            else:  # DeepSeek
                model = "deepseek-chat"
        
        messages = [{"role": "user", "content": prompt}]
        return self.chat_completion(messages, max_tokens, model, provider) 