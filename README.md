# Clerky - Clinical Guideline Assistant

Clerky is an AI-powered clinical decision support platform that helps healthcare professionals access and apply clinical guidelines efficiently. It processes clinical guideline PDFs, extracts essential information, generates interactive algorithms, and provides real-time clinical decision support with comprehensive audit capabilities and multi-provider AI integration.

## Features

### Core Clinical Decision Support
- **Real-time Guideline Analysis**: Analyzes clinical transcripts against comprehensive medical guidelines
- **Multi-Guideline Processing**: Simultaneous analysis against multiple relevant guidelines
- **Interactive Recommendations**: AI-generated suggestions with accept/reject/modify options
- **Clinical Note Generation**: Automated generation of comprehensive clinical documentation
- **Audit & Compliance**: Comprehensive audit system with automated compliance checking

### Advanced AI Integration
- **Multi-Provider Support**: 5 AI providers (DeepSeek, Mistral, Anthropic, OpenAI, Gemini)
- **Cost-Optimized Routing**: Intelligent provider selection based on cost and availability
- **Automatic Fallback**: Seamless switching between providers on quota/error conditions
- **Usage Analytics**: Real-time cost monitoring and usage tracking across all providers

### Data Processing & Management
- **PDF Processing**: Extracts and condenses text from clinical guideline PDFs
- **Metadata Enhancement**: Automated extraction and enhancement of guideline metadata
- **Content Repair**: Intelligent content repair and validation systems
- **GitHub Integration**: Version control and automated content synchronization

### Security & Privacy
- **PII Anonymization**: Advanced PII detection and anonymization with user review
- **Firebase Authentication**: Secure authentication with JWT tokens and daily disclaimers
- **Comprehensive Logging**: Structured logging with automatic archiving and monitoring
- **HIPAA Considerations**: Privacy-first design with no PHI storage

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
# AI Provider API Keys (at least one required)
DEEPSEEK_API_KEY=your_deepseek_api_key_here
MISTRAL_API_KEY=your_mistral_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
GOOGLE_AI_API_KEY=your_gemini_api_key_here

# GitHub Integration (required for guideline management)
GITHUB_TOKEN=your_github_token_here

# Firebase Configuration (required)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_app.firebaseapp.com
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_storage_bucket
FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
FIREBASE_APP_ID=your_app_id

# Firebase Admin SDK (server-side, required)
FIREBASE_ADMIN_TYPE=service_account
FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_PRIVATE_KEY_ID=your_private_key_id
FIREBASE_ADMIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_ADMIN_CLIENT_EMAIL=your_service_account_email
FIREBASE_ADMIN_CLIENT_ID=your_client_id
FIREBASE_ADMIN_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_ADMIN_TOKEN_URI=https://oauth2.googleapis.com/token
```

### AI Provider System

Clerky features an intelligent multi-provider AI system with cost-optimized routing and automatic fallback capabilities.

#### Supported Providers

1. **DeepSeek** (Primary) - `deepseek-chat` - $0.0005/1k tokens - Most cost-effective
2. **Mistral** - `mistral-large-latest` - $0.001/1k tokens - Good balance of cost and quality
3. **Anthropic** - `claude-3-sonnet-20240229` - $0.003/1k tokens - High quality, moderate cost
4. **OpenAI** - `gpt-3.5-turbo` - $0.0015/1k tokens - Reliable but can hit quota limits
5. **Google Gemini** - `gemini-1.5-pro-latest` - $0.0025/1k tokens - Good for specific use cases

#### Intelligent Routing

- **Cost-Optimized**: Automatically selects the most cost-effective available provider
- **Automatic Fallback**: Seamlessly switches providers on quota/error conditions
- **User Preferences**: Per-user AI provider selection with Firestore persistence
- **Real-time Monitoring**: Comprehensive usage tracking and cost monitoring

#### Configuration

The system automatically tries providers in cost order. You can:
- Set individual API keys for any combination of providers
- Users can select their preferred provider through the web interface
- System falls back to next available provider if the preferred one fails

## Usage

### Running the Server

Start the server:

```bash
npm start
```

The server will be available at http://localhost:3000.

### Frontend Development

#### Static App (Production)
The main application is served directly from the root directory via Firebase Hosting.

#### React App (Development)
For frontend development using the modern React interface:

```bash
cd frontend
npm install
npm run dev
```

The React development server will be available at http://localhost:5173.

### Core Workflows

#### 1. Clinical Decision Support
- Input clinical transcripts through the web interface
- System automatically finds relevant guidelines
- Receive AI-generated recommendations with interactive options
- Apply, reject, or modify suggestions as needed
- Generate comprehensive clinical notes

#### 2. Guideline Management
- Upload new guideline PDFs through the web interface
- System automatically extracts and processes content
- Metadata enhancement and content repair happens automatically
- Guidelines are synced with GitHub for version control

#### 3. Audit & Compliance
- Run compliance audits against clinical documentation
- Generate audit reports with detailed findings
- Track compliance metrics over time
- Export audit results for quality assurance

## Monitoring & Analytics

### API Usage Tracking

Monitor AI provider usage and costs:

```bash
# View real-time usage statistics
curl http://localhost:3000/api-usage-stats

# Track usage with automated scripts
node scripts/track-api-usage.js
```

Usage reports are automatically generated in the `data/api-usage` directory with detailed breakdowns by:
- Provider (DeepSeek, Mistral, Anthropic, OpenAI, Gemini)
- Endpoint usage patterns
- Cost analysis and optimization recommendations
- Token usage trends

### System Health

Monitor system health and performance:
- Health endpoint: `GET /health`
- Automatic log archiving when size limits are exceeded
- Real-time error tracking and debugging
- Comprehensive audit trails for compliance

## License

[Add your license information here]

## Contact

[Add your contact information here]

## Function Summaries

### Server Functions

- **getFileSha(filePath)**: Fetches the SHA of an existing file on GitHub.
  - **Inputs:** `filePath` (string) - Path to the file on GitHub.
  - **Outputs:** SHA of the file or null if the file does not exist.

- **updateHtmlFileOnGitHub(filePath, newHtmlContent, fileSha)**: Updates an HTML file on GitHub.
  - **Inputs:** `filePath` (string), `newHtmlContent` (string), `fileSha` (string).
  - **Outputs:** Commit and content details of the updated file.

- **sendToAI(prompt, model, systemPrompt, userId)**: Sends prompts to AI services.
  - **Inputs:** `prompt` (string), `model` (string), `systemPrompt` (string), `userId` (string).
  - **Outputs:** AI response based on the prompt and model.

- **generateAlgorithmLink(guideline)**: Generates an algorithm link for a guideline.
  - **Inputs:** `guideline` (string) - Guideline filename.
  - **Outputs:** HTML link for the guideline algorithm.

- **testGitHubAccess()**: Tests GitHub token permissions.
  - **Inputs:** None.
  - **Outputs:** Boolean indicating if access is successful.

- **verifyFilePath(filePath)**: Verifies if a file path exists on GitHub.
  - **Inputs:** `filePath` (string) - Path to the file on GitHub.
  - **Outputs:** Boolean indicating if the file exists.

- **getFileContents(fileName)**: Gets the contents of a file from GitHub.
  - **Inputs:** `fileName` (string) - Name of the file.
  - **Outputs:** Contents of the file.

- **createDefaultPrompts()**: Creates default prompts for AI interactions.
  - **Inputs:** None.
  - **Outputs:** Object containing default prompts.

- **createSession(userId)**: Creates a new session in Firestore.
  - **Inputs:** `userId` (string) - User ID.
  - **Outputs:** Session ID.

### Client Functions

- **displayGuidance()**: Displays guidance for the user based on selected contexts.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with guidance.

- **updateGuidance()**: Updates guidance based on user input.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with new guidance.

- **updateAIModel()**: Updates the AI model based on user preference.
  - **Inputs:** None.
  - **Outputs:** Updates the AI model and UI.

- **showLoginPrompt()**: Shows a login prompt if the user is not authenticated.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with a login button.

- **checkServerHealth()**: Checks the health of the server.
  - **Inputs:** None.
  - **Outputs:** Boolean indicating server health.

- **generateClinicalNote()**: Generates a clinical note based on user input.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with a clinical note.

- **appendToSummary1(content, clearExisting)**: Appends content to the summary field.
  - **Inputs:** `content` (string), `clearExisting` (boolean).
  - **Outputs:** Updates the DOM with appended content.

- **checkAgainstGuidelines()**: Checks a note against selected guidelines.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with guideline compliance analysis.

### Other Functions

- **setCookie(name, value, days)**: Sets a cookie with a specified expiration.
  - **Inputs:** `name` (string), `value` (string), `days` (number).
  - **Outputs:** None.

- **getCookie(name)**: Gets the value of a cookie.
  - **Inputs:** `name` (string).
  - **Outputs:** Value of the cookie or null if not found.

- **deleteCookie(name)**: Deletes a cookie.
  - **Inputs:** `name` (string).
  - **Outputs:** None.

- **createBanner()**: Creates a cookie consent banner.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with a banner.

- **createPreferencesModal()**: Creates a modal for cookie preferences.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM with a modal.

- **showPreferences()**: Shows the cookie preferences modal.
  - **Inputs:** None.
  - **Outputs:** Updates the DOM to show the modal.

- **getSavedConsent()**: Gets saved consent preferences.
  - **Inputs:** None.
  - **Outputs:** Object containing consent preferences.

- **acceptConsent(consent)**: Accepts consent and saves preferences.
  - **Inputs:** `consent` (object).
  - **Outputs:** Updates the DOM and saves preferences.

- **applyCookieConsent(consent)**: Applies cookie consent based on user preferences.
  - **Inputs:** `consent` (object).
  - **Outputs:** Updates the DOM and applies preferences. 