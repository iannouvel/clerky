import os
import requests
import logging
import tiktoken
import json
from typing import Optional, List, Dict
from datetime import datetime

class OpenAIClient:
    def __init__(self):
        self.api_key, self.deepseek_api_key, self.anthropic_api_key, self.mistral_api_key = self._load_credentials()
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
        anthropic_api_key = os.getenv('ANTHROPIC_API_KEY')
        mistral_api_key = os.getenv('MISTRAL_API_KEY')
        
        if not api_key and not deepseek_api_key and not anthropic_api_key and not mistral_api_key:
            raise ValueError("No API keys found in environment variables. Need at least one of: OPENAI_API_KEY, DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, or MISTRAL_API_KEY")
        
        return api_key, deepseek_api_key, anthropic_api_key, mistral_api_key

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
                elif "claude" in model:
                    provider = "Anthropic"
                elif "mistral" in model:
                    provider = "Mistral"
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
            elif provider == "DeepSeek":
                model = "deepseek-chat"
            elif provider == "Anthropic":
                model = "claude-3-sonnet-20240229"
            elif provider == "Mistral":
                model = "mistral-large-latest"
            else:
                model = "gpt-3.5-turbo"  # fallback
        
        # Select API key based on provider
        if provider == "OpenAI":
            api_key = self.api_key
        elif provider == "DeepSeek":
            api_key = self.deepseek_api_key
        elif provider == "Anthropic":
            api_key = self.anthropic_api_key
        elif provider == "Mistral":
            api_key = self.mistral_api_key
        else:
            api_key = self.api_key  # fallback to OpenAI
        
        # Fallback if the chosen provider's API key isn't available
        if not api_key:
            # Try to find an available provider
            available_providers = []
            if self.api_key:
                available_providers.append(("OpenAI", self.api_key, "gpt-3.5-turbo"))
            if self.deepseek_api_key:
                available_providers.append(("DeepSeek", self.deepseek_api_key, "deepseek-chat"))
            if self.anthropic_api_key:
                available_providers.append(("Anthropic", self.anthropic_api_key, "claude-3-sonnet-20240229"))
            if self.mistral_api_key:
                available_providers.append(("Mistral", self.mistral_api_key, "mistral-large-latest"))
            
            if available_providers:
                alt_provider, alt_key, alt_model = available_providers[0]
                logging.warning(f"{provider} API key not found, falling back to {alt_provider}")
                provider = alt_provider
                api_key = alt_key
                model = alt_model
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
            if provider == "OpenAI":
                api_endpoint = 'https://api.openai.com/v1/chat/completions'
            elif provider == "DeepSeek":
                api_endpoint = 'https://api.deepseek.com/v1/chat/completions'
            elif provider == "Anthropic":
                api_endpoint = 'https://api.anthropic.com/v1/messages'
            elif provider == "Mistral":
                api_endpoint = 'https://api.mistral.ai/v1/chat/completions'
            else:
                api_endpoint = 'https://api.openai.com/v1/chat/completions'  # fallback
            
            logging.info(f"Sending request to {provider} API using model {model}")
            
            # Set headers based on provider
            headers = {
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {api_key}'
            }
            
            # Add provider-specific headers
            if provider == "Anthropic":
                headers['anthropic-version'] = '2023-06-01'
            
            response = requests.post(
                api_endpoint,
                headers=headers,
                json=body
            )

            if response.status_code != 200:
                error_details = response.json()
                logging.error(f"{provider} API error: {error_details.get('error')}")
                return None
                
            response_json = response.json()
            
            # Extract content based on provider response format
            if provider == "Anthropic":
                content = response_json['content'][0]['text']
            else:
                content = response_json['choices'][0]['message']['content']
            
            # Extract token usage and report it
            if 'usage' in response_json:
                usage = response_json['usage']
                # Handle different usage formats
                if provider == "Anthropic":
                    # Anthropic uses input_tokens and output_tokens
                    usage = {
                        'prompt_tokens': usage.get('input_tokens', 0),
                        'completion_tokens': usage.get('output_tokens', 0),
                        'total_tokens': usage.get('input_tokens', 0) + usage.get('output_tokens', 0)
                    }
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
            elif provider == "DeepSeek":
                model = "deepseek-chat"
            elif provider == "Anthropic":
                model = "claude-3-sonnet-20240229"
            elif provider == "Mistral":
                model = "mistral-large-latest"
            else:
                model = "gpt-3.5-turbo"  # fallback
        
        messages = [{"role": "user", "content": prompt}]
        return self.chat_completion(messages, max_tokens, model, provider) 