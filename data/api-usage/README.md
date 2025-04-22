# API Usage Statistics

This directory contains API usage statistics collected by the automated workflow.

## File Structure

- `YYYY-MM-DD-raw.json`: Raw API usage data from the OpenAI API
- `YYYY-MM-DD-summary.json`: Processed summary of API usage including token counts and costs

## Summary Format

The summary files contain:

- Date information
- Total token usage across all models
- Total cost
- Breakdown by model, including:
  - Prompt tokens
  - Completion tokens
  - Total tokens
  - Cost

This data is updated daily by the GitHub Actions workflow. 