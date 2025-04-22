# Clerky - Clinical Guideline Assistant

Clerky is a web application that helps healthcare professionals access and apply clinical guidelines efficiently. It processes clinical guideline PDFs, extracts essential information, and generates interactive algorithms to aid in clinical decision-making.

## Features

- Extracts and condenses text from clinical guideline PDFs
- Identifies significant clinical terms and keywords
- Generates concise summaries of guidelines
- Creates interactive HTML algorithms for clinical decision-making
- Supports both OpenAI and DeepSeek AI providers

## Setup

### Prerequisites

- Node.js (v14+)
- Python 3.8+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone https://github.com/iannouvel/clerky.git
cd clerky
```

2. Install Node.js dependencies:
```bash
npm install
```

3. Install Python dependencies:
```bash
pip install -r requirements.txt
```

4. Create a `.env` file with your API keys:
```
OPENAI_API_KEY=your_openai_api_key_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
PREFERRED_AI_PROVIDER=OpenAI  # or "DeepSeek"

# Firebase Configuration (if using Firebase)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_app.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_storage_bucket
FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
FIREBASE_APP_ID=your_app_id
```

### Using Multiple AI Providers

Clerky now supports both OpenAI and DeepSeek as AI providers for processing clinical guidelines and generating algorithms.

#### Switching Providers

You can switch between providers in two ways:

1. Set the `PREFERRED_AI_PROVIDER` environment variable in your `.env` file to either `OpenAI` or `DeepSeek`.

2. Use the web interface to switch providers (if available in your deployment).

If one provider's API key is missing or invalid, Clerky will automatically fall back to the other provider if its API key is available.

#### Configuration

Each provider may use different models:

- **OpenAI:** Uses `gpt-3.5-turbo` by default, with `gpt-4-turbo` for algorithm generation
- **DeepSeek:** Uses `deepseek-chat` for all operations

## Usage

### Running the Server

Start the server:

```bash
npm start
```

The server will be available at http://localhost:3000.

### Processing Guidelines

1. Place clinical guideline PDFs in the `guidance` folder
2. Process the PDFs to extract and condense text:
```bash
python scripts/1_process_pdf.py
```

3. Extract significant terms:
```bash
python scripts/2_extract_terms.py
```

4. Generate summaries:
```bash
python scripts/3_generate_summary.py
```

5. Generate interactive algorithms:
```bash
python scripts/generate_algo.py
```

## API Usage Tracking

Track API usage with:

```bash
node scripts/track-api-usage.js
```

This will generate reports in the `data/api-usage` directory for both OpenAI and DeepSeek (if configured).

## License

[Add your license information here]

## Contact

[Add your contact information here] 