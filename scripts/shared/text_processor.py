import logging
from typing import Optional
from .config import Config
from .openai_client import OpenAIClient

class TextProcessor:
    def __init__(self, config: Config, openai_client: OpenAIClient):
        self.config = config
        self.openai_client = openai_client

    def extract_significant_terms(self, text: str) -> Optional[str]:
        """
        Verify this still works with the updated OpenAIClient
        """
        prompt = (
            "From the following clinical guideline text, extract the most clinically significant terms "
            "and keywords that are critical for understanding the guidance:\n\n"
            f"{text}"
        )
        # This still works because _make_request is now a wrapper around chat_completion
        return self.openai_client._make_request(prompt, max_tokens=500)

    def generate_summary(self, text):
        """Generate a summary of the given text, handling large texts by chunking if needed."""
        try:
            # Calculate approximate tokens
            tokens = len(text) / 4  # Rough estimate of tokens
            
            if tokens > 3000:  # If text is too long, split and summarize in parts
                chunks = self._split_text(text, max_tokens=3000)
                summaries = []
                
                for chunk in chunks:
                    response = self.openai_client.chat_completion([
                        {"role": "system", "content": "You are a medical documentation expert. Create a machine-readable summary that organizes clinical guidance into these sections:\n\nDiagnosis and Presentation:\n- List specific diagnostic criteria and clinical presentations\n- Use full medical terms, not abbreviations\n- Include exact values/thresholds if mentioned\n\nTreatment and Management:\n- List specific interventions and protocols\n- Do not include medication doses\n- Use full names of medications\n\nMonitoring Requirements:\n- List specific parameters to monitor\n- Include monitoring frequency if specified\n\nContraindications and Cautions:\n- List specific contraindications\n- List specific risk factors\n\nFormat each point with semicolons. DO NOT include references, ICD codes, or acronyms. Use complete medical terminology. This is for machine processing to match clinical situations against guidelines."},
                        {"role": "user", "content": chunk}
                    ])
                    if response:
                        summaries.append(response)
                
                # Combine summaries
                combined_summary = " ".join(summaries)
                
                # Final consolidation if needed
                if len(combined_summary) > 2000:
                    return self.generate_summary(combined_summary)  # Recursive call for final consolidation
                return combined_summary
                
            else:
                # Original behavior for shorter texts
                response = self.openai_client.chat_completion([
                    {"role": "system", "content": "You are a medical documentation expert. Create a machine-readable summary that organizes clinical guidance into these sections:\n\nDiagnosis and Presentation:\n- List specific diagnostic criteria and clinical presentations\n- Use full medical terms, not abbreviations\n- Include exact values/thresholds if mentioned\n\nTreatment and Management:\n- List specific interventions and protocols\n- Do not include medication doses\n- Use full names of medications\n\nMonitoring Requirements:\n- List specific parameters to monitor\n- Include monitoring frequency if specified\n\nContraindications and Cautions:\n- List specific contraindications\n- List specific risk factors\n\nFormat each point with semicolons. DO NOT include references, ICD codes, or acronyms. Use complete medical terminology. This is for machine processing to match clinical situations against guidelines."},
                    {"role": "user", "content": text}
                ])
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