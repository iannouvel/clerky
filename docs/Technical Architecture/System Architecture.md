# Clerky - Clinical Decision Support Platform
## Technical Product Specification

### System Overview

Clerky is a full-stack web application built with modern web technologies, implementing a microservices architecture with Firebase backend services, AI model integration, and comprehensive data processing pipelines for medical guideline analysis and clinical decision support.

---

## Architecture Overview

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Server API    │    │   AI Services   │
│   (Client)      │◄──►│   (Node.js)     │◄──►│   (OpenAI/      │
│                 │    │                 │    │    DeepSeek)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Firebase      │    │   GitHub        │    │   File Storage  │
│   (Auth/DB)     │    │   (Guidelines)  │    │   (PDFs/Docs)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### Technology Stack

#### Frontend
- **Dual Architecture**: 
  - **Static App**: Vanilla JavaScript (ES6+) with custom CSS and responsive design
  - **React SPA**: React 19 with Vite 6 build system
- **State Management**: 
  - **Static**: Global JavaScript objects and Firebase real-time listeners
  - **React**: Zustand for client state + React Query 5 for server state
- **Authentication**: Firebase Authentication v11.4.0 with JWT tokens
- **HTTP Client**: Axios for API communication
- **Build Tools**: 
  - **Static**: Native ES modules with webpack for PII library bundling
  - **React**: Vite 6 with ESLint 9 and modern tooling
- **Deployment**: Firebase Hosting with SPA rewrites

#### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Hosting**: Render.com
- **Authentication**: Firebase Admin SDK
- **API Design**: RESTful endpoints with JWT

#### Database & Storage
- **Primary Database**: Firebase Firestore
- **File Storage**: Firebase Storage + GitHub repository
- **Caching**: In-memory object caching
- **Data Format**: JSON documents

#### AI Integration
- **Multi-Provider System**: 5 AI providers with cost-optimized routing
- **Primary Provider**: DeepSeek Chat (most cost-effective at $0.0005/1k tokens)
- **Provider Hierarchy**: DeepSeek → Mistral → Anthropic → OpenAI → Gemini
- **Intelligent Fallback**: Automatic provider switching on quota/error conditions
- **Usage Tracking**: Comprehensive analytics with real-time cost monitoring across all providers
- **User Preferences**: Per-user AI provider selection with Firestore persistence

#### External Services
- **Version Control**: GitHub API for guideline management
- **PDF Processing**: PDF-parse library
- **Text Processing**: Custom NLP pipelines
- **Logging**: File-based logging with GitHub storage

---

## System Components

### 1. Frontend Application (`script.js`)

#### Core Modules
- **Authentication Manager**: Firebase Auth integration
- **Guideline Processor**: PDF and text analysis
- **AI Interface**: Multi-provider AI service communication
- **Session Manager**: Chat history and state persistence
- **UI Controller**: Dynamic content rendering and interaction

#### Key Functions
```javascript
// Core workflow functions
async function findRelevantGuidelines(suppressHeader = false)
async function checkAgainstGuidelines(suppressHeader = false)
async function generateMultiGuidelineAdvice()
async function dynamicAdvice(transcript, analysis, guidelineId, guidelineTitle)

// Data management
async function loadGuidelinesFromFirestore()
async function saveChatToFirestore(chat)
async function enhanceGuidelineMetadata(guidelineId, specificFields = null)

// UI rendering
function displayRelevantGuidelines(categories)
async function displayInteractiveSuggestions(suggestions, guidelineTitle)
function appendToSummary1(content, clearExisting = false)
```

#### State Management
```javascript
// Global state objects
let window.relevantGuidelines = [];      // Currently relevant guidelines
let window.globalGuidelines = {};        // All loaded guidelines
let window.latestAnalysis = {};          // Current analysis results
let currentAdviceSession = null;         // Active advice session
let currentSuggestions = [];             // Current AI suggestions
let userDecisions = {};                  // User decision tracking
let chatHistory = [];                    // Session history
```

### 2. Server Application (`server.js`)

#### Core Endpoints

##### Authentication & User Management
```javascript
POST /updateAIPreference          // Update user's preferred AI model
GET  /getUserAIPreference/:userId // Get user's AI preference
```

##### Guideline Management
```javascript
GET  /getAllGuidelines           // Fetch all guidelines from Firestore
POST /syncGuidelines            // Sync guidelines from GitHub to Firestore
POST /migrateNullMetadata       // Repair missing guideline content
GET  /getGuidelineContent       // Fetch specific guideline content
```

##### AI Analysis Services
```javascript
POST /findRelevantGuidelines    // Find guidelines relevant to clinical input
POST /checkGuidelines          // Analyze transcript against guidelines
POST /dynamicAdvice           // Generate interactive suggestions
POST /applyDecisions          // Apply user decisions to transcript
POST /generateClinicalNote    // Generate clinical documentation
```

##### Data Processing
```javascript
POST /getRecommendations       // Get AI recommendations
POST /routeToAI              // Route requests to appropriate AI provider
GET  /api-usage-stats        // Get API usage and cost statistics
```

##### Administrative Functions
```javascript
POST /deleteAllLogs           // Delete all log files
POST /deleteAllSummaries      // Delete all summaries from Firestore
POST /deleteAllGuidelineData  // Delete all guideline data
POST /uploadPDFsToStorage     // Upload PDFs to Firebase Storage
POST /admin/archive-logs-if-needed    // Archive logs when they exceed size limits
POST /admin/clean-guideline-titles    // Clean and standardize guideline titles
```

##### Clinical Conditions & Transcript Management
```javascript
GET  /clinicalConditions              // Get all clinical conditions
POST /generateTranscript/:conditionId // Generate transcript for specific condition
POST /generateAllTranscripts          // Generate transcripts for all conditions
POST /initializeClinicalConditions    // Initialize clinical conditions database
```

##### Content Enhancement & Processing
```javascript
POST /enhanceGuidelineMetadata        // Enhance metadata for specific guideline
POST /batchEnhanceMetadata           // Batch enhance metadata for multiple guidelines
POST /processGuidelineContent        // Process and extract guideline content
POST /getGuidelinesNeedingContent    // Get guidelines missing content
POST /ensureMetadataCompletion       // Ensure all guidelines have complete metadata
```

##### User Preferences & Customization
```javascript
GET  /userGuidelinePrefs             // Get user guideline preferences
POST /userGuidelinePrefs/update      // Update user guideline preferences
POST /reconcileUserInclude           // Reconcile user include preferences
GET  /guidance-exclusions            // Get guidance exclusions
POST /guidance-exclusions            // Update guidance exclusions
```

##### Audit & Compliance System
```javascript
POST /auditElementCheck              // Check specific audit elements
POST /generateAuditTranscript        // Generate audit transcript
POST /generateIncorrectAuditScripts  // Generate incorrect audit scripts for testing
POST /updateGuidelinesWithAuditableElements // Update guidelines with auditable elements
```

#### AI Integration Layer

##### Provider Management
```javascript
async function sendToAI(prompt, model = 'deepseek-chat', systemPrompt = null, userId = null)
async function routeToAI(prompt, userId = null)
async function getUserAIPreference(userId)
async function updateUserAIPreference(userId, provider)
```

##### Fallback Strategy
```javascript
// Automatic fallback on quota/error
if (error.code === 'insufficient_quota') {
    // Switch to alternative provider
    return await fallbackProvider.complete(prompt);
}
```

### 3. Data Processing Pipeline

#### PDF Processing Workflow
```python
# scripts/1_process_pdf.py
1. Extract text from PDF files using pdf-parse
2. Clean and normalize extracted text
3. Store in guidance/extracted_content/
4. Generate condensed versions for analysis
```

#### Guideline Enhancement Pipeline
```javascript
// Metadata enhancement process
async function enhanceGuidelineMetadata(guidelineId, specificFields = null) {
    1. Extract title, organization, year from content
    2. Generate human-friendly titles
    3. Create standardized metadata
    4. Store enhanced data in Firestore
}
```

#### Content Repair System
```javascript
async function diagnoseAndRepairContent() {
    1. Identify guidelines with missing content/condensed text
    2. Fetch original PDFs from GitHub
    3. Extract and process text content
    4. Generate missing condensed versions
    5. Update Firestore with repaired content
}
```

### 4. Database Schema

#### Firestore Collections

##### Guidelines Collection
```json
{
  "id": "string",                    // Unique identifier
  "title": "string",                 // Original title
  "humanFriendlyTitle": "string",    // Enhanced readable title
  "organisation": "string",          // Issuing organization
  "yearProduced": "number",          // Publication year
  "content": "string",               // Full extracted text
  "condensed": "string",             // Condensed version for analysis
  "keywords": "array",               // Extracted keywords
  "summary": "string",               // AI-generated summary
  "downloadUrl": "string",           // PDF download link
  "originalFilename": "string",      // Source PDF filename
  "metadata": {                      // Additional metadata
    "category": "string",
    "specialty": "string",
    "lastUpdated": "timestamp"
  }
}
```

##### Chat History Collection
```json
{
  "id": "string",                    // Chat session ID
  "userId": "string",                // User identifier
  "title": "string",                 // Chat title
  "messages": "array",               // Chat messages
  "timestamp": "timestamp",          // Creation time
  "lastModified": "timestamp",       // Last update time
  "state": {                         // Session state
    "transcript": "string",
    "analysis": "object",
    "decisions": "object"
  }
}
```

##### User Preferences Collection
```json
{
  "userId": "string",                // User identifier
  "aiProvider": "string",            // Preferred AI provider
  "settings": {                      // User settings
    "notifications": "boolean",
    "autoSave": "boolean",
    "theme": "string"
  },
  "lastUpdated": "timestamp"
}
```

### 5. AI Integration Architecture

#### Multi-Provider Support
```javascript
const AI_PROVIDER_PREFERENCE = [
  {
    name: 'DeepSeek',
    model: 'deepseek-chat',
    costPer1kTokens: 0.0005, // $0.0005 per 1k tokens (cheapest)
    priority: 1,
    description: 'Most cost-effective option'
  },
  {
    name: 'Mistral',
    model: 'mistral-large-latest',
    costPer1kTokens: 0.001, // $0.001 per 1k tokens
    priority: 2,
    description: 'Good balance of cost and quality'
  },
  {
    name: 'Anthropic',
    model: 'claude-3-sonnet-20240229',
    costPer1kTokens: 0.003, // $0.003 per 1k tokens
    priority: 3,
    description: 'High quality, moderate cost'
  },
  {
    name: 'OpenAI',
    model: 'gpt-3.5-turbo',
    costPer1kTokens: 0.0015, // $0.0015 per 1k tokens
    priority: 4,
    description: 'Reliable but can hit quota limits'
  },
  {
    name: 'Gemini',
    model: 'gemini-1.5-pro-latest',
    costPer1kTokens: 0.0025, // $0.0025 per 1k tokens
    priority: 5,
    description: 'Google\'s offering, good for specific use cases'
  }
];
```

#### Request Flow
```
1. User Input → Frontend
2. Frontend → Server API
3. Server → AI Provider Selection
4. AI Provider → Generate Response
5. Server → Process & Format Response
6. Server → Frontend
7. Frontend → Display Results
```

#### Error Handling & Fallback
```javascript
async function handleAIRequest(prompt, userId) {
    try {
        // Try primary provider
        return await primaryProvider.complete(prompt);
    } catch (error) {
        if (isQuotaError(error)) {
            // Fallback to secondary provider
            return await secondaryProvider.complete(prompt);
        }
        throw error;
    }
}
```

---

## Technical Implementation Details

### 1. Multi-Guideline Processing

#### Parallel Processing Architecture
```javascript
async function multiGuidelineDynamicAdvice(selectedGuidelines) {
    // Process guidelines in parallel using Promise.allSettled
    const guidelinePromises = selectedGuidelines.map(async (guideline) => {
        return await processIndividualGuideline(guideline);
    });
    
    const results = await Promise.allSettled(guidelinePromises);
    return combineResults(results);
}
```

#### Error Isolation
- Individual guideline failures don't stop overall processing
- Comprehensive error reporting for failed guidelines
- Graceful degradation with partial results

### 2. Real-time UI Updates

#### Progress Tracking
```javascript
const updateProcessingStatus = (guidelineId, status, emoji = '⏳') => {
    const statusElement = document.querySelector(`[data-guideline-id="${guidelineId}"] .processing-status`);
    if (statusElement) {
        statusElement.textContent = emoji;
    }
};
```

#### Dynamic Content Rendering
```javascript
async function displayCombinedSuggestions(successfulResults, failedResults) {
    // Combine suggestions from multiple guidelines
    // Render interactive UI with accept/reject/modify options
    // Handle bulk actions and decision tracking
}
```

### 3. Authentication & Security

#### Firebase Authentication Integration
```javascript
// Initialize Firebase Auth
import { getAuth, onAuthStateChanged } from 'firebase/auth';

onAuthStateChanged(auth, (user) => {
    if (user) {
        // User signed in
        enableProtectedFeatures();
    } else {
        // User signed out
        redirectToLogin();
    }
});
```

#### JWT Token Management
```javascript
// Server-side token verification
const authenticateUser = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
};
```

### 4. Performance Optimization

#### Caching Strategy
```javascript
// In-memory caching for frequently accessed data
const guidelineCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

async function getCachedGuideline(id) {
    if (guidelineCache.has(id)) {
        const cached = guidelineCache.get(id);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.data;
        }
    }
    // Fetch from database if not cached or expired
    const data = await fetchFromFirestore(id);
    guidelineCache.set(id, { data, timestamp: Date.now() });
    return data;
}
```

#### Lazy Loading
```javascript
// Load guidelines on demand
async function loadMoreLogs(startIndex, count) {
    const endIndex = Math.min(startIndex + count, allLogFiles.length);
    const filesToLoad = allLogFiles.slice(startIndex, endIndex);
    // Process and load additional content
}
```

### 5. Error Handling & Debugging

#### Comprehensive Error Tracking
```javascript
// Global error handler with context
window.addEventListener('error', (event) => {
    const errorContext = {
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
    };
    
    logError(errorContext);
});
```

#### Debug Utilities
```javascript
// Built-in debugging helpers
window.debugMultiGuideline = function() {
    // Comprehensive state inspection
    // Validation checks
    // Performance metrics
};

window.testMultiGuidelineSetup = async function() {
    // Pre-flight checks
    // Configuration validation
    // Connectivity tests
};
```

---

## API Documentation

### Core Endpoints

#### POST /findRelevantGuidelines
**Purpose**: Analyze clinical input and find relevant guidelines
**Authentication**: Required (JWT)
**Request**:
```json
{
  "transcript": "string",           // Clinical text to analyze
  "guidelines": "array",            // Available guidelines
  "options": {                      // Analysis options
    "maxRelevant": "number",
    "threshold": "number"
  }
}
```
**Response**:
```json
{
  "success": "boolean",
  "categories": {
    "mostRelevant": "array",        // High relevance guidelines
    "potentiallyRelevant": "array", // Medium relevance guidelines
    "lessRelevant": "array",        // Low relevance guidelines
    "notRelevant": "array"          // Not relevant guidelines
  },
  "analysis": "object"              // Analysis metadata
}
```

#### POST /dynamicAdvice
**Purpose**: Generate interactive suggestions for clinical documentation
**Authentication**: Required (JWT)
**Request**:
```json
{
  "transcript": "string",           // Clinical transcript
  "analysis": "object",             // Previous analysis results
  "guidelineId": "string",          // Target guideline ID
  "guidelineTitle": "string"        // Guideline title
}
```
**Response**:
```json
{
  "success": "boolean",
  "sessionId": "string",            // Session identifier
  "suggestions": "array",           // Interactive suggestions
  "metadata": {                     // Processing metadata
    "processingTime": "number",
    "aiProvider": "string",
    "tokensUsed": "number"
  }
}
```

#### POST /applyDecisions
**Purpose**: Apply user decisions to clinical transcript
**Authentication**: Required (JWT)
**Request**:
```json
{
  "sessionId": "string",            // Session identifier
  "decisions": "object",            // User decisions
  "originalTranscript": "string"    // Original clinical text
}
```
**Response**:
```json
{
  "success": "boolean",
  "updatedTranscript": "string",    // Modified transcript
  "changes": "array",               // List of applied changes
  "summary": {                      // Change summary
    "accepted": "number",
    "rejected": "number",
    "modified": "number"
  }
}
```

---

## Data Flow Diagrams

### 1. Clinical Analysis Workflow
```
User Input → Frontend Validation → Server API → AI Analysis → 
Guideline Matching → Result Processing → UI Update → User Review
```

### 2. Multi-Guideline Processing
```
Guideline Selection → Parallel Processing → Individual Analysis → 
Result Aggregation → Combined Suggestions → Interactive UI → 
User Decisions → Applied Changes → Updated Transcript
```

### 3. Authentication Flow
```
User Login → Firebase Auth → JWT Token → Server Validation → 
Protected Resource Access → User Preference Loading → 
Session Initialization → Feature Access
```

---

## Security Considerations

### Data Protection
- **Encryption**: All data in transit (HTTPS) and at rest (Firebase encryption)
- **Authentication**: Firebase Authentication with JWT tokens and daily disclaimer acceptance
- **Authorization**: Role-based access control for administrative functions
- **PII Anonymization**: Advanced PII detection and anonymization using @libretto/redact-pii-light
  - Real-time PII detection with risk level assessment
  - Interactive user review interface for PII matches
  - Configurable anonymization with user approval workflow
  - Support for medical terminology and clinical context
- **Data Minimization**: No PHI storage, only anonymized clinical scenarios for analysis

### API Security
- **Rate Limiting**: Implemented to prevent abuse
- **Input Validation**: Comprehensive sanitization of all inputs
- **CORS Configuration**: Restricted to authorized domains
- **Audit Logging**: All API calls logged with user context

### Privacy Compliance
- **GDPR Compliance**: User data export and deletion capabilities
- **HIPAA Considerations**: No PHI processing or storage
- **Data Retention**: Configurable retention policies
- **User Consent**: Explicit consent for data processing

---

## Deployment & Infrastructure

### Frontend Deployment
- **Platform**: GitHub Pages
- **CDN**: GitHub's global CDN
- **SSL**: Automatic HTTPS
- **Domain**: Custom domain support

### Backend Deployment
- **Platform**: Render.com with automatic deployments
- **Scaling**: Automatic horizontal scaling with health monitoring
- **Health Checks**: Built-in health monitoring via `/health` endpoint
- **Logging**: Comprehensive logging system with:
  - Structured JSON logs with correlation IDs
  - Automatic log archiving when size limits exceeded
  - Real-time error tracking and debugging
  - AI usage and cost monitoring across all providers
- **Environment**: Production environment with secure environment variable management

### Database & Storage
- **Primary**: Firebase Firestore (auto-scaling)
- **File Storage**: Firebase Storage + GitHub repository
- **Backup**: Automatic Firebase backups
- **Monitoring**: Firebase Analytics and Performance Monitoring

### CI/CD Pipeline
```yaml
# GitHub Actions workflow
name: Deploy
on: [push to main]
jobs:
  deploy:
    - Build and test
    - Deploy to staging
    - Run integration tests
    - Deploy to production
    - Monitor deployment
```

---

## Performance Specifications

### Response Time Requirements
- **Guideline Search**: < 2 seconds
- **AI Analysis**: < 10 seconds
- **UI Updates**: < 500ms
- **File Upload**: < 5 seconds per MB

### Scalability Targets
- **Concurrent Users**: 100+ simultaneous users
- **Database Operations**: 1000+ operations/second
- **API Throughput**: 500+ requests/minute
- **Storage**: 10GB+ guidelines and documents

### Availability Requirements
- **Uptime**: 99.9% availability
- **Recovery Time**: < 5 minutes for critical issues
- **Backup Recovery**: < 1 hour for full restoration
- **Monitoring**: 24/7 automated monitoring with alerts

---

## Monitoring & Analytics

### Application Monitoring
- **Performance Metrics**: Response times, error rates, throughput
- **User Analytics**: Usage patterns, feature adoption, session duration
- **AI Model Performance**: Accuracy tracking, cost monitoring, provider comparison
- **System Health**: Server resources, database performance, storage usage

### Cost Tracking
```javascript
// AI usage cost monitoring
const costData = {
    totalCalls: number,
    totalTokensUsed: number,
    estimatedTotalCost: number,
    byProvider: {
        OpenAI: { calls, tokensUsed, estimatedCost },
        DeepSeek: { calls, tokensUsed, estimatedCost }
    },
    byEndpoint: {
        endpoint: { calls, tokensUsed, estimatedCost }
    }
};
```

### Logging Strategy
- **Application Logs**: Structured JSON logs with correlation IDs
- **Access Logs**: All API requests with response codes and timing
- **Error Logs**: Detailed error context and stack traces
- **Audit Logs**: User actions and administrative operations

---

## Future Technical Considerations

### Scalability Enhancements
- **Microservices Architecture**: Break down monolithic server
- **Caching Layer**: Redis for high-performance caching
- **Load Balancing**: Multi-instance deployment with load balancer
- **Database Sharding**: Distribute data across multiple Firestore instances

### Advanced AI Integration
- **Model Fine-tuning**: Custom models trained on medical guidelines
- **Embedding Vectors**: Semantic search using vector databases
- **Real-time Processing**: Streaming AI responses for better UX
- **Multi-modal AI**: Support for image and document analysis

### Enterprise Features
- **EHR Integration**: HL7 FHIR compatibility
- **SSO Integration**: SAML/OAuth enterprise authentication
- **API Gateway**: Comprehensive API management and documentation
- **Data Analytics**: Advanced reporting and business intelligence

### Mobile Development
- **Progressive Web App**: Enhanced mobile experience
- **Native Apps**: iOS and Android applications
- **Offline Capability**: Core functionality without internet
- **Push Notifications**: Real-time alerts and updates

---

## Conclusion

The Clerky platform represents a sophisticated integration of modern web technologies, AI services, and healthcare data processing. The technical architecture prioritizes scalability, security, and user experience while maintaining the flexibility to evolve with changing requirements and emerging technologies.

Key technical strengths include:
- **Modular Architecture**: Easy to extend and maintain
- **Multi-provider AI**: Reliability through redundancy
- **Real-time Processing**: Responsive user experience
- **Comprehensive Monitoring**: Data-driven optimization
- **Security-first Design**: Healthcare-grade protection

The platform is well-positioned for future enhancements and enterprise-scale deployment while maintaining its core mission of improving clinical decision-making through intelligent technology integration. 