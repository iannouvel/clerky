const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config(); // For environment variables
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const admin = require('firebase-admin');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PDFParser = require('pdf-parse');

// ============================================================================
// AI PROVIDER COST-EFFECTIVE ITERATION SYSTEM
// ============================================================================
// Provider preference array ordered by cost (cheapest first, most expensive last)
// This ensures we try the most cost-effective providers before falling back to expensive ones
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

// Helper function to get next available provider in cost order
function getNextAvailableProvider(currentProvider, availableKeys) {
  const currentIndex = AI_PROVIDER_PREFERENCE.findIndex(p => p.name === currentProvider);
  if (currentIndex === -1) return AI_PROVIDER_PREFERENCE[0]; // Default to cheapest
  
  // Start from the next provider after current
  for (let i = currentIndex + 1; i < AI_PROVIDER_PREFERENCE.length; i++) {
    const provider = AI_PROVIDER_PREFERENCE[i];
    if (availableKeys[`has${provider.name}Key`]) {
      return provider;
    }
  }
  
  // If no next provider available, try from the beginning
  for (let i = 0; i < currentIndex; i++) {
    const provider = AI_PROVIDER_PREFERENCE[i];
    if (availableKeys[`has${provider.name}Key`]) {
      return provider;
    }
  }
  
  return null; // No available providers
}

// Note: Firebase Admin will be initialized later with proper error handling
// This early initialization is removed to prevent duplicate app errors

// Initialize Express app
const app = express();

// Apply middleware
app.use(cors());
app.use(helmet());

// Authentication middleware
const authenticateUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).json({ message: 'No authorization header' });
    }
    try {
        // Verify Firebase token
        const token = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken;
        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

// Configure logging
const winston = require('winston');
const { format } = winston;
const punycode = require('punycode');
const stringSimilarity = require('string-similarity');

// Configure punycode to be used instead of built-in module
process.env.NODE_OPTIONS = '--no-deprecation';

// Create required directories if they don't exist
const logsDir = path.join(__dirname, 'logs');
const knowledgeDir = path.join(__dirname, 'knowledge');
[logsDir, knowledgeDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Configure Winston logger
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        format.timestamp(),
        format.errors({ stack: true }),
        format.json()
    ),
    defaultMeta: { service: 'clerky-server' },
    transports: [
        // Write all logs to console
        new winston.transports.Console({
            format: format.combine(
                format.colorize(),
                format.simple()
            )
        }),
        // Write all logs with level 'info' and below to combined.log
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        }),
        // Write all logs with level 'error' and below to error.log
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true
        })
    ]
});

// Override console methods to use Winston
console.log = (...args) => logger.info(...args);
console.error = (...args) => logger.error(...args);
console.warn = (...args) => logger.warn(...args);
console.debug = (...args) => logger.debug(...args);

// Load prompts and agent knowledge configuration
let prompts, agentKnowledge;
try {
    prompts = require('./prompts.json');
    agentKnowledge = require('./agent_knowledge.json');
} catch (error) {
    console.error('Error loading configuration files:', error);
    prompts = {
        guidelines: {
            prompt: "Please identify ONLY the guidelines that DIRECTLY address the management of this specific clinical issue. \nThe guidelines must contain specific recommendations or protocols for managing this exact condition.\n\nRules:\n- Select ONLY guidelines the most relevant 1 or 2 guidelines that have this issue as their primary focus\n- Return ONLY the exact filenames of relevant guidelines\n- List each filename on a new line\n- Do not add any additional text or explanations\n\nIssue: {{text}}\n\nAvailable guidelines:\n{{guidelines}}",
            system_prompt: "You are a medical AI assistant helping to identify relevant clinical guidelines for specific medical issues."
        }
    };
    agentKnowledge = {
        testing: {
            accuracy_thresholds: {
                excellent: 95,
                good: 85,
                acceptable: 75,
                needs_review: 60
            },
            cost_guidelines: {
                per_test_target: 0.02,
                daily_budget: 5.00,
                warning_threshold: 0.05
            },
            response_times: {
                fast: 500,
                normal: 1000,
                slow: 2000
            }
        },
        guidelines: {
            categories: ["BJOG", "CG", "BMS", "BASHH", "BHIVA", "ESHRE", "FIGO", "GP"],
            update_frequency: "monthly",
            validation_process: "Each guideline undergoes automated compliance checking and manual clinical review"
        },
        agent_capabilities: {
            test_types: [
                {
                    name: "Clinical Advice Test",
                    description: "Validates recommendation generation against guidelines",
                    typical_accuracy: 92
                },
                {
                    name: "Guideline Relevance Test",
                    description: "Checks accuracy of guideline matching",
                    typical_accuracy: 88
                },
                {
                    name: "Compliance Detection Test",
                    description: "Identifies guideline compliance issues",
                    typical_accuracy: 95
                }
            ],
            monitoring: [
                "Real-time accuracy tracking",
                "Cost optimization",
                "Response time analysis",
                "Provider performance comparison"
            ]
        }
    };
}

// Create a write stream for server logs
const serverLogStream = fs.createWriteStream(path.join(logsDir, 'server.log'), { flags: 'a' });

// Save original console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

// Override console.log
console.log = (...args) => {
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg).join(' ');
    const timestamp = new Date().toISOString();
    serverLogStream.write(`[${timestamp}] [LOG] ${message}\n`);
    originalConsoleLog.apply(console, args); // Also log to the original console
};

// Function to load agent knowledge from Firestore
async function loadAgentKnowledge() {
    try {
        const knowledgeRef = admin.firestore().collection('agent_knowledge');
        const snapshot = await knowledgeRef.get();
        
        const knowledge = {};
        snapshot.forEach(doc => {
            knowledge[doc.id] = doc.data();
        });
        
        // Merge with static knowledge
        return {
            ...agentKnowledge,
            dynamic: knowledge
        };
    } catch (error) {
        console.error('Error loading agent knowledge from Firestore:', error);
        return agentKnowledge;
    }
}

// Endpoint to get agent knowledge
app.get('/getAgentKnowledge', authenticateUser, async (req, res) => {
    try {
        const knowledge = await loadAgentKnowledge();
        
        // Add user-specific customizations if available
        const userCustomizations = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('agent_preferences')
            .doc('knowledge')
            .get();
            
        if (userCustomizations.exists) {
            knowledge.user_specific = userCustomizations.data();
        }
        
        res.json({
            success: true,
            knowledge
        });
    } catch (error) {
        console.error('Error serving agent knowledge:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load agent knowledge'
        });
    }
});

// Override console.error
console.error = (...args) => {
    // Enhanced error logging that preserves error objects
    const timestamp = new Date().toISOString();
    
    // Create a detailed message for file logging
    const message = args.map(arg => {
        if (arg instanceof Error) {
            return `Error: ${arg.message}\nStack: ${arg.stack}`;
        }
        return typeof arg === 'object' ? JSON.stringify(arg, Object.getOwnPropertyNames(arg), 2) : arg;
    }).join(' ');
    
    serverLogStream.write(`[${timestamp}] [ERROR] ${message}\n`);
    
    // Pass original arguments to preserve error objects in Winston
    logger.error(...args);
    originalConsoleError.apply(console, args); // Also log to the original console
};

const PORT = process.env.PORT || 3000;

// Enable trust proxy
app.set('trust proxy', true);

// Temporarily disable CSP for testing
app.use((req, res, next) => {
  res.removeHeader('Content-Security-Policy');
  next();
});

// Serve static files
app.use(express.static(__dirname));

// Increase payload limits to handle large guideline datasets
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 1. Centralized CORS Configuration with Logging ---
const corsOptions = {
  origin: (origin, callback) => {
    // Commented out - too verbose for production logs
    // console.log(`[CORS Origin Check] Request origin: ${origin}`);
    const allowedOrigins = [
      'https://iannouvel.github.io',
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:5500',
      'https://clerkyai.health'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      // console.log(`[CORS Origin Check] Origin allowed: ${origin || '(no origin - server-to-server or direct)'}`);
      callback(null, true);
    } else {
      console.error(`[CORS Origin Check] Origin blocked: ${origin}`);
      callback(new Error('Not allowed by CORS policy for this server'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  credentials: true,
  maxAge: 86400, // 24 hours
  preflightContinue: false,
  optionsSuccessStatus: 204
};

// --- 2. Global and Early Preflight Handling with Logging ---
console.log('[CORS Setup] Applying global OPTIONS handler: app.options("*")');
app.options('*', cors(corsOptions));

// --- 3. Apply CORS to all routes ---
app.use(cors(corsOptions));

// --- 4. Add CORS headers to all responses ---
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && corsOptions.origin(origin, (err, allowed) => allowed)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', corsOptions.maxAge);
  }
  next();
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      message: 'Too many requests, please try again later.'
    });
  },
  validate: {
    trustProxy: true, // Enable trust proxy validation
    xForwardedForHeader: true // Enable X-Forwarded-For header validation
  },
  keyGenerator: (req) => {
    // Use X-Forwarded-For header or fallback to remote address
    return req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  }
});

// Apply rate limiting to all routes that use OpenAI
app.use('/generateFakeClinicalInteraction', apiLimiter);
app.use('/handleAction', apiLimiter);
app.use('/SendToAI', apiLimiter);

// GitHub repository details
const githubOwner = 'iannouvel';
const githubRepo = 'clerky';
const githubBranch = 'main';
const githubFolder = 'guidance';
let githubToken = process.env.GITHUB_TOKEN; // GitHub token for authentication

// Validate GitHub token on startup
if (!githubToken) {
    console.error('GITHUB_TOKEN environment variable is not set!');
    process.exit(1);
}

// Update the token validation function
function validateGitHubToken() {
    console.log('[DEBUG] validateGitHubToken: Starting GitHub token validation...');
    
    if (!githubToken) {
        console.error('[ERROR] validateGitHubToken: GITHUB_TOKEN is not set!');
        process.exit(1);
    }
    
    console.log('[DEBUG] validateGitHubToken: Token exists, length:', githubToken.length);
    
    // Clean the token
    let cleanToken = githubToken.trim().replace(/\n/g, '');
    console.log('[DEBUG] validateGitHubToken: Token after cleaning, length:', cleanToken.length);
    
    // Remove Bearer prefix if it exists
    if (cleanToken.startsWith('Bearer ')) {
        console.log('[DEBUG] validateGitHubToken: Removing Bearer prefix');
        cleanToken = cleanToken.substring(7);
    }
    
    // Update the global token
    githubToken = cleanToken;
    console.log('[DEBUG] validateGitHubToken: Token validation complete, final length:', githubToken.length);
}

// Call validation on startup
validateGitHubToken();

// Function to fetch the SHA of the existing file on GitHub
async function getFileSha(filePath) {
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}?ref=${githubBranch}`;
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${githubToken}`
        };
        
        const response = await axios.get(url, { headers });
        return response.data.sha;
    } catch (error) {
        console.error('Error details:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.response?.data?.message,
            documentation_url: error.response?.data?.documentation_url
        });
        if (error.response?.status === 404) {
            //console.log('File does not exist yet, will create new file');
            return null;
        }
        throw new Error(`Failed to fetch file SHA: ${error.response?.data?.message || error.message}`);
    }
}

// Function to update the HTML file on GitHub
async function updateHtmlFileOnGitHub(filePath, newHtmlContent, fileSha) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
    
    const body = {
        message: `Update ${filePath} with new content`,
        content: Buffer.from(newHtmlContent).toString('base64'),
        branch: githubBranch
    };

    if (fileSha) {
        body.sha = fileSha;
    }

    try {
        const response = await axios.put(url, body, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return {
            commit: response.data.commit,
            content: response.data.content
        };
    } catch (error) {
        const status = error.response?.status;
        const errorMessage = error.response?.data?.message || error.message;
        const documentationUrl = error.response?.data?.documentation_url;

        console.error('GitHub API Error:', {
            status,
            statusText: error.response?.statusText,
            message: errorMessage,
            documentation_url: documentationUrl
        });

        if (status === 404) {
            throw new Error('Resource not found. Please check the file path and repository details.');
        } else if (status === 409) {
            throw new Error('Conflict detected. Please ensure no concurrent modifications are being made.');
        } else if (status === 422) {
            throw new Error('Validation failed. Please check the request parameters and data.');
        } else {
            throw new Error(`Failed to update file: ${errorMessage}`);
        }
    }
}

// Function to fetch the condensed file from GitHub
async function fetchCondensedFile(guidelineFilename) {
    // Replace .html with .pdf to get the correct file
    // This function now assumes the primary PDF is in guidance/ and is the source for condensed text.
    const pdfFilename = guidelineFilename.replace('.html', '.pdf');
    const filePath = `guidance/${encodeURIComponent(pdfFilename)}`; // Path changed
    const url = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${githubBranch}/${filePath}`;

    try {
        console.log(`[FETCH_CONDENSED] Fetching raw file from GitHub: ${url}`);
        const response = await axios.get(url);
        console.log(`[FETCH_CONDENSED] Successfully fetched ${filePath}. Length: ${response.data?.length}`);
        return response.data; // This will be the raw PDF content (binary or buffer-like depending on axios)
    } catch (error) {
        console.error('Error fetching condensed file from GitHub:', error.response?.data || error.message);
        throw new Error('Failed to retrieve the condensed guideline');
    }
}

// Function to extract text from PDF buffer
async function extractTextFromPDF(pdfBuffer) {
    try {
        console.log(`[PDF_EXTRACT] Starting PDF text extraction, buffer size: ${pdfBuffer.length}`);
        const data = await PDFParser(pdfBuffer);
        const extractedText = data.text;
        
        if (!extractedText || extractedText.trim().length === 0) {
            console.warn(`[PDF_EXTRACT] No text extracted from PDF`);
            return null;
        }
        
        // Basic text cleanup
        const cleanedText = extractedText
            .replace(/\f/g, '\n')  // Form feeds to newlines
            .replace(/\x0c/g, '\n')  // Form feeds to newlines
            .replace(/\n\s*\n\s*\n/g, '\n\n')  // Multiple newlines to double
            .replace(/ +/g, ' ')  // Multiple spaces to single
            .replace(/\t+/g, ' ')  // Tabs to spaces
            .trim();
        
        console.log(`[PDF_EXTRACT] Successfully extracted text: ${cleanedText.length} characters`);
        return cleanedText;
    } catch (error) {
        console.error(`[PDF_EXTRACT] Error extracting text from PDF:`, error);
        return null;
    }
}

// Function to fetch PDF from GitHub and extract text
async function fetchAndExtractPDFText(pdfFileName) {
    try {
        // First try to fetch from Firebase Storage
        console.log(`[FETCH_PDF] Attempting to fetch PDF from Firebase Storage: ${pdfFileName}`);
        
        try {
            const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
            const file = bucket.file(`pdfs/${pdfFileName}`);
            
            const [exists] = await file.exists();
            if (exists) {
                console.log(`[FETCH_PDF] Found PDF in Firebase Storage: ${pdfFileName}`);
                const [buffer] = await file.download();
                console.log(`[FETCH_PDF] Downloaded from Firebase Storage, size: ${buffer.length} bytes`);
                
                // Extract text from PDF
                const extractedText = await extractTextFromPDF(buffer);
                return extractedText;
            } else {
                console.log(`[FETCH_PDF] PDF not found in Firebase Storage, trying GitHub: ${pdfFileName}`);
            }
        } catch (storageError) {
            console.log(`[FETCH_PDF] Firebase Storage fetch failed, trying GitHub: ${storageError.message}`);
        }
        
        // Fallback to GitHub if not in Firebase Storage
        const pdfPath = `guidance/${encodeURIComponent(pdfFileName)}`;
        console.log(`[FETCH_PDF] Fetching PDF from GitHub: ${pdfPath}`);
        
        // Construct the GitHub raw content URL
        const githubUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${pdfPath}`;
        
        // Fetch PDF file from GitHub API
        try {
            const response = await axios.get(githubUrl, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            
            if (response.data.content) {
                // GitHub API returns base64-encoded content for binary files
                buffer = Buffer.from(response.data.content, 'base64');
                console.log(`[FETCH_PDF] Successfully fetched PDF from GitHub API, size: ${buffer.length} bytes`);
                } else {
                throw new Error('No content found in GitHub API response');
            }
        } catch (err) {
            console.error(`[FETCH_PDF] Failed to fetch from GitHub API: ${err.message}`);
                throw err;
        }
        
        // Extract text from PDF
        const extractedText = await extractTextFromPDF(buffer);
        return extractedText;
        
    } catch (error) {
        console.error(`[FETCH_PDF] Error fetching/extracting PDF ${pdfFileName}:`, error.message);
        throw error;
    }
}

// Function to generate condensed text from content using AI
async function generateCondensedText(fullText, userId = null) {
    try {
        console.log(`[CONDENSE] Starting text condensation, input length: ${fullText.length}`);
        
        const prompt = `With the attached text from a clinical guideline, please return a condensed version of the text which removes clinically insignificant text, please remove all the scientific references, if there are any, at the end of the text as they do not need to be in the condensed output, please do not change the clinically significant text at all.

Text to condense:
${fullText}`;

        const messages = [
            { 
                role: 'system', 
                content: 'You are a medical text processing assistant. Condense clinical guidelines by removing insignificant content and references while preserving all clinically important information.' 
            },
            { role: 'user', content: prompt }
        ];
        
        // Force DeepSeek for content generation to avoid OpenAI quota issues
        const aiResult = await sendToAI(messages, 'deepseek-chat', null, userId);
        
        if (aiResult && aiResult.content) {
            const condensedText = aiResult.content.trim();
            console.log(`[CONDENSE] Successfully condensed text: ${fullText.length} -> ${condensedText.length} characters`);
            return condensedText;
        } else {
            console.warn(`[CONDENSE] AI did not return condensed text`);
            return null;
        }
        
    } catch (error) {
        console.error(`[CONDENSE] Error generating condensed text:`, error);
        return null;
    }
}

// Function to check if a guideline needs content generation
async function checkAndGenerateContent(guidelineData, guidelineId) {
    try {
        let updated = false;
        const updates = {};
        
        // Check if content is missing
        if (!guidelineData.content) {
            console.log(`[CONTENT_GEN] Content missing for ${guidelineId}, attempting to extract from PDF`);
            
            try {
                // Determine PDF filename
                let pdfFileName = null;
                if (guidelineData.filename && guidelineData.filename.toLowerCase().endsWith('.pdf')) {
                    pdfFileName = guidelineData.filename;
                } else if (guidelineData.originalFilename && guidelineData.originalFilename.toLowerCase().endsWith('.pdf')) {
                    pdfFileName = guidelineData.originalFilename;
                } else if (guidelineData.filename) {
                    pdfFileName = guidelineData.filename.replace(/\.[^.]+$/, '.pdf');
                } else if (guidelineData.title) {
                    pdfFileName = guidelineData.title + '.pdf';
                }
                
                if (pdfFileName) {
                    console.log(`[CONTENT_GEN] Attempting to extract text from PDF: ${pdfFileName}`);
                    const extractedContent = await fetchAndExtractPDFText(pdfFileName);
                    
                    if (extractedContent && extractedContent.trim().length > 0) {
                        updates.content = extractedContent;
                        console.log(`[CONTENT_GEN] Successfully extracted content for ${guidelineId}: ${extractedContent.length} chars`);
                        updated = true;
                    } else {
                        console.log(`[CONTENT_GEN] PDF extraction returned empty content for ${guidelineId}`);
                    }
                } else {
                    console.log(`[CONTENT_GEN] Could not determine PDF filename for ${guidelineId}`);
                }
            } catch (pdfError) {
                console.log(`[CONTENT_GEN] PDF extraction failed for ${guidelineId}: ${pdfError.message}`);
            }
        }
        
        // Check if condensed is missing (check both document and condensed collection)
        const condensedRef = db.collection('condensed').doc(guidelineId);
        const condensedDoc = await condensedRef.get();
        
        if (!guidelineData.condensed && !condensedDoc.exists) {
            console.log(`[CONTENT_GEN] Condensed text missing for ${guidelineId}, attempting generation`);
            
            const sourceContent = updates.content || guidelineData.content;
            if (sourceContent) {
                try {
                    const condensedText = await generateCondensedText(sourceContent, 'system');
                    if (condensedText) {
                        // Save to condensed collection
                        await condensedRef.set({
                            condensed: condensedText,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            generatedDate: new Date().toISOString(),
                            sourceType: updates.content ? 'extracted_pdf' : 'existing_content'
                        });
                        
                        // Also save to main document for easier access
                        updates.condensed = condensedText;
                        
                        console.log(`[CONTENT_GEN] Generated condensed text for ${guidelineId}: ${condensedText.length} chars`);
                        updated = true;
                    }
                } catch (error) {
                    console.log(`[CONTENT_GEN] Failed to generate condensed text for ${guidelineId}: ${error.message}`);
                }
            }
        }
        
        // Save content updates to main document if any
        if (Object.keys(updates).length > 0) {
            const guidelineRef = db.collection('guidelines').doc(guidelineId);
            updates.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
            updates.contentGenerated = true;
            updates.generationDate = new Date().toISOString();
            
            await guidelineRef.update(updates);
            console.log(`[CONTENT_GEN] Updated guideline ${guidelineId} with generated content`);
        }
        
        return updated;
        
    } catch (error) {
        console.error(`[CONTENT_GEN] Error checking/generating content for ${guidelineId}:`, error);
        return false;
    }
}
// Set default AI provider to DeepSeek if not already set
if (!process.env.PREFERRED_AI_PROVIDER) {
  process.env.PREFERRED_AI_PROVIDER = 'DeepSeek';
  console.log('Setting default AI provider to DeepSeek');
}
// Declare db in the outer scope
let db = null;
// Firebase Admin SDK initialization
try {
  // Use REST API transports for Firestore to avoid gRPC issues
  // process.env.FIRESTORE_EMULATOR_HOST = 'no-grpc-force-rest.dummy';
  
  // Process the private key correctly with better validation
  console.log('[DEBUG] Firebase: Processing private key...');
  let privateKey;
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    // Handle base64 encoded private key (preferred method for environment variables)
    console.log('[DEBUG] Firebase: Using base64 encoded private key');
    try {
      privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
      console.log('[DEBUG] Firebase: Successfully decoded base64 private key');
    } catch (decodeError) {
      throw new Error(`Failed to decode base64 private key: ${decodeError.message}`);
    }
  } else if (process.env.FIREBASE_PRIVATE_KEY) {
    // Handle different possible formats of the private key (fallback method)
    let rawKey = process.env.FIREBASE_PRIVATE_KEY;
    
    // Remove any quotes that might be wrapping the key
    rawKey = rawKey.replace(/^["']|["']$/g, '');
    
    // Replace escaped newlines with actual newlines
    privateKey = rawKey.replace(/\\n/g, '\n');
    
    // Validate the private key format
    const keyStart = privateKey.indexOf('-----BEGIN PRIVATE KEY-----');
    const keyEnd = privateKey.indexOf('-----END PRIVATE KEY-----');
    
    if (keyStart === -1 || keyEnd === -1) {
      console.error('Invalid private key format: Missing BEGIN/END markers');
      console.log('Key starts with:', privateKey.substring(0, 50));
      console.log('Key ends with:', privateKey.substring(privateKey.length - 50));
      
      // Try alternative formats
      if (privateKey.indexOf('BEGIN PRIVATE KEY') > -1 && privateKey.indexOf('END PRIVATE KEY') > -1) {
        // Add missing dashes
        privateKey = privateKey.replace(/BEGIN PRIVATE KEY/g, '-----BEGIN PRIVATE KEY-----');
        privateKey = privateKey.replace(/END PRIVATE KEY/g, '-----END PRIVATE KEY-----');
        console.log('Fixed private key format by adding dashes');
      } else {
        throw new Error('Firebase private key is malformed - cannot find valid PEM format. Consider using FIREBASE_PRIVATE_KEY_BASE64 instead.');
      }
    } else {
      console.log('Private key format appears correct');
    }
    
    // Additional validation - check for proper line structure
    const lines = privateKey.split('\n');
    if (lines.length < 3) {
      console.warn('Private key has unusually few lines, attempting to fix formatting...');
      
      // Try to reconstruct proper line breaks
      const keyContent = privateKey.replace(/-----BEGIN PRIVATE KEY-----/, '')
                                   .replace(/-----END PRIVATE KEY-----/, '')
                                   .replace(/\s+/g, '');
      
      // Reconstruct with proper 64-character lines
      const formattedKey = '-----BEGIN PRIVATE KEY-----\n' +
                          keyContent.match(/.{1,64}/g).join('\n') +
                          '\n-----END PRIVATE KEY-----';
      
      privateKey = formattedKey;
      console.log('Reformatted private key with proper line breaks');
    }
    
  } else {
    throw new Error('Neither FIREBASE_PRIVATE_KEY nor FIREBASE_PRIVATE_KEY_BASE64 environment variable is set');
  }
  
  // Test the private key before using it
  console.log('[DEBUG] Firebase: Testing private key validity...');
  try {
    const testMessage = 'test';
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(testMessage);
    sign.sign(privateKey); // This will throw if the key is invalid
    console.log('[DEBUG] Firebase: Private key validation successful');
  } catch (keyError) {
    console.error('[ERROR] Firebase: Private key validation failed:', keyError.message);
    throw new Error(`Invalid private key format: ${keyError.message}`);
  }
  
  // Initialize the SDK with validated credentials
  const serviceAccount = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: privateKey
  };
  
  // Validate all required fields
  if (!serviceAccount.projectId || !serviceAccount.clientEmail || !serviceAccount.privateKey) {
    throw new Error('Missing required Firebase configuration fields');
  }
  
  console.log('[DEBUG] Firebase: Initializing Firebase Admin SDK...');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'clerky-b3be8.firebasestorage.app'
  });
  
  console.log('[DEBUG] Firebase: Firebase Admin SDK initialized successfully');
  
  // Initialize Firestore with additional error handling
  console.log('[DEBUG] Firebase: Initializing Firestore...');
  db = admin.firestore();
  db.settings({
    ignoreUndefinedProperties: true,
    preferRest: true // Prefer REST API over gRPC
  });
  
  console.log('[DEBUG] Firebase: Firestore instance created with REST API configuration');
  
} catch (error) {
  console.error('[ERROR] Firebase: Error initializing Firebase Admin SDK:', {
    message: error.message,
    stack: error.stack,
    code: error.code,
    errorObject: JSON.stringify(error, Object.getOwnPropertyNames(error)),
    context: {
      hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
      hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
      hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY_BASE64 || !!process.env.FIREBASE_PRIVATE_KEY,
      privateKeySource: process.env.FIREBASE_PRIVATE_KEY_BASE64 ? 'base64' : (process.env.FIREBASE_PRIVATE_KEY ? 'raw' : 'none'),
      initializationStage: 'Firebase Admin SDK initialization',
      timestamp: new Date().toISOString()
    }
  });
  console.log('[DEBUG] Firebase: Continuing without Firebase Firestore due to initialization error');
  console.log('[DEBUG] Firebase: The application will work with limited functionality (no guideline persistence)');
  
  // Set db to null to indicate Firestore is not available
  db = null;
}

// Add file system module for fallback storage
const userPrefsDir = path.join(__dirname, 'user_preferences');
if (!fs.existsSync(userPrefsDir)) {
  try {
    fs.mkdirSync(userPrefsDir, { recursive: true });
    console.log('Created user preferences directory');
  } catch (err) {
    console.error('Error creating user preferences directory:', err);
  }
}

// Add a global cache for user preferences near the top of the file, after other global declarations
// Global user preferences cache
const userPreferencesCache = new Map();
const USER_PREFERENCE_CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Update the getUserAIPreference function to use the cache and the correct db variable
async function getUserAIPreference(userId) {
    // Check if we have a cached preference for this user
    if (userPreferencesCache.has(userId)) {
        const cachedData = userPreferencesCache.get(userId);
        // Check if the cached data is still valid
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            console.log(`Using cached AI preference for user ${userId}: ${cachedData.preference}`);
            return cachedData.preference;
        } else {
            // Cached data is expired, remove it
            userPreferencesCache.delete(userId);
        }
    }

    console.log(`Attempting to get AI preference for user: ${userId}`);
    
    try {
        // Try Firestore first if available
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    console.log('User preference document exists in Firestore:', data);
                    
                    if (data && data.aiProvider) {
                        // Cache the preference
                        userPreferencesCache.set(userId, {
                            preference: data.aiProvider,
                            timestamp: Date.now()
                        });
                        return data.aiProvider;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserAIPreference, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                console.log('User preference file exists:', userData);
                if (userData && userData.aiProvider) {
                    // Cache the preference
                    userPreferencesCache.set(userId, {
                        preference: userData.aiProvider,
                        timestamp: Date.now()
                    });
                    return userData.aiProvider;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }
        
        // Default to DeepSeek if no preference found
        const defaultProvider = 'DeepSeek';
        
        // Cache the default preference
        userPreferencesCache.set(userId, {
            preference: defaultProvider,
            timestamp: Date.now()
        });
        
        return defaultProvider;
    } catch (error) {
        console.error('Critical error in getUserAIPreference:', error);
        return 'DeepSeek'; // Default to DeepSeek on error
    }
}

// Update the updateUserAIPreference function to update the cache
async function updateUserAIPreference(userId, provider) {
    console.log(`Updating AI preference for user ${userId} to ${provider}`);
    
    // Update cache immediately
    userPreferencesCache.set(userId, {
        preference: provider,
        timestamp: Date.now()
    });
    
    try {
        // Try to update in Firestore if available
        if (db) {
            try {
                await db.collection('userPreferences').doc(userId).set({
                    aiProvider: provider,
                    updatedAt: new Date().toISOString()
                });
                console.log(`Successfully updated AI preference in Firestore for user: ${userId}`);
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserAIPreference, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        try {
            // Save to local JSON file
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            
            fs.writeFileSync(userPrefsFilePath, JSON.stringify({
                aiProvider: provider,
                updatedAt: new Date().toISOString()
            }));
            
            console.log(`Successfully updated AI preference in local file for user: ${userId}`);
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserAIPreference:', error);
        return false;
    }
}

// Function to format messages based on provider
function formatMessagesForProvider(messages, provider) {
    switch (provider) {
        case 'OpenAI':
            return messages;
        case 'DeepSeek':
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        case 'Anthropic':
            // Claude uses a different message format
            return messages.map(msg => ({
                role: msg.role === 'system' ? 'user' : msg.role, // Claude doesn't support system role directly
                content: msg.role === 'system' ? `System: ${msg.content}` : msg.content
            }));
        case 'Mistral':
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        case 'Gemini':
            // Gemini expects [{role, parts: [{text}]}]
            return messages.map(msg => ({
                role: msg.role === 'system' ? 'user' : msg.role,
                parts: [{ text: msg.content }]
            }));
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}
// Function to send prompts to AI services
async function sendToAI(prompt, model = 'deepseek-chat', systemPrompt = null, userId = null) {
  // Initialize preferredProvider at the very beginning to ensure it's always defined
  let preferredProvider = 'DeepSeek'; // Default fallback
  
  try {
    // Determine the provider based on the model, but don't override the model
    if (model.includes('deepseek')) {
      preferredProvider = 'DeepSeek';
    } else if (model.includes('claude') || model.includes('anthropic')) {
      preferredProvider = 'Anthropic';
    } else if (model.includes('mistral')) {
      preferredProvider = 'Mistral';
    } else if (model.includes('gemini')) {
      preferredProvider = 'Gemini';
    } else if (model.includes('gpt')) {
      preferredProvider = 'OpenAI';
    } else {
      preferredProvider = 'DeepSeek'; // Default to DeepSeek if unknown model
    }
    
    console.log('[DEBUG] sendToAI initial configuration:', {
      promptType: typeof prompt,
      isArray: Array.isArray(prompt),
      requestedModel: model,
      initialProvider: preferredProvider,
      hasSystemPrompt: !!systemPrompt,
      userId: userId || 'none'
    });
    
    // Override with userId preference if provided
    if (userId) {
      try {
        // Use the cached preference (which will fetch if needed)
        const userPreference = await getUserAIPreference(userId);
        
        // Only update if the user preference is different from what was requested
        if (userPreference !== preferredProvider) {
          console.log('[DEBUG] Overriding provider based on user preference:', {
            requestedModel: model,
            initialProvider: preferredProvider,
            userPreference,
            userId
          });
          preferredProvider = userPreference;
          
          // Only update the model if it doesn't match the preferred provider
          if (preferredProvider === 'OpenAI' && !model.includes('gpt')) {
            console.log('[DEBUG] Updating model to match OpenAI provider');
            model = 'gpt-3.5-turbo';
          } else if (preferredProvider === 'DeepSeek' && !model.includes('deepseek')) {
            console.log('[DEBUG] Updating model to match DeepSeek provider');
            model = 'deepseek-chat';
          } else if (preferredProvider === 'Anthropic' && !model.includes('claude')) {
            console.log('[DEBUG] Updating model to match Anthropic provider');
            model = 'claude-3-sonnet-20240229';
          } else if (preferredProvider === 'Mistral' && !model.includes('mistral')) {
            console.log('[DEBUG] Updating model to match Mistral provider');
            model = 'mistral-large-latest';
          } else if (preferredProvider === 'Gemini' && !model.includes('gemini')) {
            console.log('[DEBUG] Updating model to match Gemini provider');
            model = 'gemini-1.5-pro';
          }
        }
      } catch (error) {
        console.error('[DEBUG] Error getting user AI preference:', {
          error: error.message,
          userId,
          usingModelBasedProvider: true
        });
      }
    }
    
    // Check if we have the API key for the preferred provider
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasMistralKey = !!process.env.MISTRAL_API_KEY;
    const hasGeminiKey = !!process.env.GOOGLE_AI_API_KEY;
    
    console.log('[DEBUG] API key availability:', {
      preferredProvider,
      requestedModel: model,
      hasOpenAIKey,
      hasDeepSeekKey,
      hasAnthropicKey,
      hasMistralKey,
      hasGeminiKey
    });
    
    // ============================================================================
    // COST-EFFECTIVE PROVIDER FALLBACK SYSTEM
    // ============================================================================
    // Check if we have the API key for the preferred provider, if not, iterate through
    // available providers in cost order (cheapest first)
    const availableKeys = {
      hasOpenAIKey,
      hasDeepSeekKey,
      hasAnthropicKey,
      hasMistralKey,
      hasGeminiKey
    };
    
    // Check if current preferred provider has API key
    const hasCurrentProviderKey = availableKeys[`has${preferredProvider}Key`];
    
    if (!hasCurrentProviderKey) {
      console.log(`[DEBUG] No API key for ${preferredProvider}, searching for next available provider in cost order...`);
      
      // Get next available provider in cost order
      const nextProvider = getNextAvailableProvider(preferredProvider, availableKeys);
      
      if (nextProvider) {
        console.log(`[DEBUG] Falling back to ${nextProvider.name} (${nextProvider.description}) - Cost: $${nextProvider.costPer1kTokens}/1k tokens`);
        preferredProvider = nextProvider.name;
        model = nextProvider.model;
      } else {
        throw new Error('No AI provider API keys configured');
      }
    }
    
    // Construct the messages array
    let messages = [];
    if (Array.isArray(prompt)) {
      // If prompt is already a messages array, use it directly
      messages = prompt;
    } else {
      // If prompt is a string, construct messages array
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });
    }
    
    // Format messages for the specific provider
    const formattedMessages = formatMessagesForProvider(messages, preferredProvider);
    
    let responseData;
    let content;
    let tokenUsage = {};
    
    if (preferredProvider === 'OpenAI') {
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: model,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 4000
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        }
      });
      
      responseData = response.data;
      content = responseData.choices[0].message.content;
      
      // Extract token usage information for cost calculation
      if (responseData.usage) {
        tokenUsage = {
          prompt_tokens: responseData.usage.prompt_tokens,
          completion_tokens: responseData.usage.completion_tokens,
          total_tokens: responseData.usage.total_tokens
        };
        
        // Calculate approximate cost - May 2023 pricing for gpt-3.5-turbo
        // Input: $0.0015 per 1K tokens, Output: $0.002 per 1K tokens
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.0015;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.002;
        const totalCost = inputCost + outputCost;
        
        console.log(`OpenAI API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    } else if (preferredProvider === 'DeepSeek') {
      const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: model,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      responseData = response.data;
      content = responseData.choices[0].message.content;
      
      // Extract token usage information for cost calculation
      if (responseData.usage) {
        tokenUsage = {
          prompt_tokens: responseData.usage.prompt_tokens,
          completion_tokens: responseData.usage.completion_tokens,
          total_tokens: responseData.usage.total_tokens
        };
        
        // Calculate approximate cost - Using current DeepSeek pricing (estimated)
        // This may need adjustment based on actual DeepSeek pricing
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.0005;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.0005;
        const totalCost = inputCost + outputCost;
        
        console.log(`DeepSeek API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    } else if (preferredProvider === 'Anthropic') {
      const response = await axios.post('https://api.anthropic.com/v1/messages', {
        model: model,
        messages: formattedMessages,
        max_tokens: 4000,
        temperature: 0.7
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        }
      });
      
      responseData = response.data;
      content = responseData.content[0].text;
      
      // Extract token usage information for cost calculation
      if (responseData.usage) {
        tokenUsage = {
          prompt_tokens: responseData.usage.input_tokens,
          completion_tokens: responseData.usage.output_tokens,
          total_tokens: responseData.usage.input_tokens + responseData.usage.output_tokens
        };
        
        // Calculate approximate cost - Claude 3 Sonnet pricing
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.003;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.015;
        const totalCost = inputCost + outputCost;
        
        console.log(`Anthropic API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    } else if (preferredProvider === 'Mistral') {
      const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
        model: model,
        messages: formattedMessages,
        temperature: 0.7,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      
      responseData = response.data;
      content = responseData.choices[0].message.content;
      
      // Extract token usage information for cost calculation
      if (responseData.usage) {
        tokenUsage = {
          prompt_tokens: responseData.usage.prompt_tokens,
          completion_tokens: responseData.usage.completion_tokens,
          total_tokens: responseData.usage.total_tokens
        };
        
        // Calculate approximate cost - Mistral Large pricing
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.0007;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.0028;
        const totalCost = inputCost + outputCost;
        
        console.log(`Mistral API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    } else if (preferredProvider === 'Gemini') {
      // Gemini requires a different message format
      const geminiMessages = formattedMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.content }]
      }));
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 4000
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          params: {
            key: process.env.GOOGLE_AI_API_KEY
          }
        }
      );
      
      responseData = response.data;
      // Gemini returns candidates[0].content.parts[0].text
      content = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
      
      // Gemini usage: responseData.usageMetadata
      if (responseData.usageMetadata) {
        tokenUsage = {
          prompt_tokens: responseData.usageMetadata.promptTokenCount,
          completion_tokens: responseData.usageMetadata.candidatesTokenCount,
          total_tokens: responseData.usageMetadata.totalTokenCount
        };
        
        // Calculate approximate cost - Gemini pricing
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.0025;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.0075;
        const totalCost = inputCost + outputCost;
        
        console.log(`Gemini API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    }

    // Return both the response content and AI provider information
    return {
      content: content,
      ai_provider: preferredProvider,
      ai_model: model,
      token_usage: tokenUsage
    };
  } catch (error) {
    console.error('Error in sendToAI:', error.response?.data || error.message);
    
    // Ensure preferredProvider is defined for error handling
    if (!preferredProvider) {
      preferredProvider = 'DeepSeek'; // Default fallback
    }
    
    // ============================================================================
    // COST-EFFECTIVE QUOTA EXCEEDED FALLBACK SYSTEM
    // ============================================================================
    // Check if it's a quota exceeded error and try next available provider in cost order
    const quotaExceededError = error.response?.data?.error?.message?.includes('exceeded your current quota') ||
                               error.response?.data?.error?.message?.includes('quota') ||
                               error.response?.data?.error?.message?.includes('rate limit');
    
    if (quotaExceededError) {
      console.log(`[DEBUG] ${preferredProvider} quota exceeded, attempting cost-effective fallback...`);
      
      // Get available keys for fallback
      const availableKeys = {
        hasOpenAIKey: !!process.env.OPENAI_API_KEY,
        hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
        hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
        hasMistralKey: !!process.env.MISTRAL_API_KEY,
        hasGeminiKey: !!process.env.GOOGLE_AI_API_KEY
      };
      
      // Get next available provider in cost order
      const nextProvider = getNextAvailableProvider(preferredProvider, availableKeys);
      
      if (nextProvider) {
        console.log(`[DEBUG] Falling back to ${nextProvider.name} (${nextProvider.description}) - Cost: $${nextProvider.costPer1kTokens}/1k tokens`);
        
        try {
          // Retry with next provider
          const formattedMessages = formatMessagesForProvider(messages, nextProvider.name);
          
          let response;
          if (nextProvider.name === 'DeepSeek') {
            response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: 0.7,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
              }
            });
          } else if (nextProvider.name === 'OpenAI') {
            response = await axios.post('https://api.openai.com/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: 0.7,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              }
            });
          } else if (nextProvider.name === 'Anthropic') {
            response = await axios.post('https://api.anthropic.com/v1/messages', {
              model: nextProvider.model,
              messages: formattedMessages,
              max_tokens: 4000
            }, {
              headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
              }
            });
          } else if (nextProvider.name === 'Mistral') {
            response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: 0.7,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
              }
            });
          } else if (nextProvider.name === 'Gemini') {
            // Gemini requires a different message format
            const geminiMessages = formattedMessages.map(msg => ({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: [{ text: msg.content }]
            }));
            
            response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${nextProvider.model}:generateContent`, {
              contents: geminiMessages,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 4000
              }
            }, {
              headers: {
                'Content-Type': 'application/json'
              },
              params: {
                key: process.env.GOOGLE_AI_API_KEY
              }
            });
          }
          
          if (response) {
            const responseData = response.data;
            let content;
            
            // Extract content based on provider
            if (nextProvider.name === 'Anthropic') {
              content = responseData.content[0].text;
            } else if (nextProvider.name === 'Gemini') {
              content = responseData.candidates[0].content.parts[0].text;
            } else {
              content = responseData.choices[0].message.content;
            }
            
            // Extract token usage
            let tokenUsage = {};
            if (responseData.usage) {
              tokenUsage = {
                prompt_tokens: responseData.usage.prompt_tokens,
                completion_tokens: responseData.usage.completion_tokens,
                total_tokens: responseData.usage.total_tokens
              };
              
              const inputCost = (tokenUsage.prompt_tokens / 1000) * nextProvider.costPer1kTokens;
              const outputCost = (tokenUsage.completion_tokens / 1000) * nextProvider.costPer1kTokens;
              const totalCost = inputCost + outputCost;
              
              console.log(`${nextProvider.name} Fallback API Call Cost: $${totalCost.toFixed(6)}`);
              tokenUsage.estimated_cost_usd = totalCost;
            }
            
            console.log(`[DEBUG] Successfully fell back to ${nextProvider.name}`);
            return {
              content: content,
              ai_provider: nextProvider.name,
              ai_model: nextProvider.model,
              token_usage: tokenUsage,
              fallback_used: true,
              original_error: `${preferredProvider} quota exceeded`
            };
          }
        } catch (fallbackError) {
          console.error(`[DEBUG] ${nextProvider.name} fallback also failed:`, fallbackError.message);
        }
      } else {
        console.error('[DEBUG] No available providers for fallback');
      }
    }
    
    throw new Error(`AI request failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Update the route function to use the new sendToAI
async function routeToAI(prompt, userId = null, preferredProvider = null) {
  try {
    // Set default AI provider to the cheapest available option
    const defaultProvider = AI_PROVIDER_PREFERENCE[0].name; // DeepSeek (cheapest)
    
    console.log('[DEBUG] routeToAI called with:', {
      promptType: typeof prompt,
      isObject: typeof prompt === 'object',
      hasMessages: prompt?.messages ? 'yes' : 'no',
      userId: userId || 'none'
    });
    
    // Use preferred provider if specified, otherwise use cheapest provider as default
    let provider = preferredProvider || defaultProvider; // Use preferred or default to DeepSeek (cheapest)
    
    if (!preferredProvider && userId) {
      try {
        const userPreference = await getUserAIPreference(userId);
        if (userPreference) {
          provider = userPreference;
          console.log('[DEBUG] User AI preference retrieved:', {
            userId,
            provider,
            defaultProvider
          });
        } else {
          console.log('[DEBUG] No user preference found, using cheapest provider:', {
            userId,
            provider: defaultProvider
          });
        }
      } catch (error) {
        console.error('[DEBUG] Error getting user AI preference:', {
          error: error.message,
          userId,
          usingDefault: true
        });
        // Keep using defaultProvider (DeepSeek)
      }
    } else if (preferredProvider) {
      console.log('[DEBUG] Using specified AI provider:', {
        preferredProvider,
        provider
      });
    } else {
      console.log('[DEBUG] No user ID provided, using cheapest provider:', {
        provider: defaultProvider
      });
    }
    
    // Determine the appropriate model based on the provider
    let model;
    switch (provider) {
      case 'OpenAI':
        model = 'gpt-3.5-turbo';
        break;
      case 'DeepSeek':
        model = 'deepseek-chat';
        break;
      case 'Anthropic':
        model = 'claude-3-sonnet-20240229';
        break;
      case 'Mistral':
        model = 'mistral-large-latest';
        break;
      case 'Gemini':
        model = 'gemini-1.5-pro';
        break;
      default:
        model = 'deepseek-chat';
    }
    console.log('[DEBUG] Selected AI configuration:', {
      provider,
      model,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasMistralKey: !!process.env.MISTRAL_API_KEY,
      hasGeminiKey: !!process.env.GOOGLE_AI_API_KEY
    });
    
    // Handle both string prompts and message objects
    let result;
    if (typeof prompt === 'object' && prompt.messages) {
      // If prompt is a message object, use it directly
      result = await sendToAI(prompt.messages, model, null, userId);
    } else {
      // If prompt is a string, use it as a user message
      result = await sendToAI(prompt, model, null, userId);
    }
    
    console.log('[DEBUG] AI service response:', JSON.stringify({
      success: !!result,
      hasContent: !!result?.content,
      contentLength: result?.content?.length,
      contentPreview: result?.content?.substring(0, 100) + '...',
      aiProvider: result?.ai_provider,
      aiModel: result?.ai_model,
      tokenUsage: result?.token_usage
    }, null, 2));
    
    return result;
  } catch (error) {
    console.error('[DEBUG] Error in routeToAI:', {
      error: error.message,
      stack: error.stack,
      userId,
      provider: process.env.PREFERRED_AI_PROVIDER
    });
    throw error;
  }
}

// New endpoint to handle action button functionality for the client
app.post('/handleAction', authenticateUser, async (req, res) => {
    const { prompt, selectedGuideline } = req.body;

    // Validate the input
    if (!prompt || !selectedGuideline) {
        return res.status(400).json({
            success: false,
            message: 'Prompt and selected guideline are required'
        });
    }

    try {
        // Step 1: Send the prompt to AI to get relevant guidelines
        const aiResponse = await routeToAI(prompt, req.user.uid);

        // Extract content from the response if it's an object
        const responseText = aiResponse && typeof aiResponse === 'object' 
            ? aiResponse.content 
            : aiResponse;
            
        if (!responseText) {
            throw new Error('Invalid response format from AI service');
        }

        // Extract the relevant guidelines from AI's response
        const relevantGuidelines = responseText.trim().split('\n')
            .map(guideline => guideline.trim())
            .filter(guideline => guideline);

        // Step 2: Generate an algorithm link for the selected guideline
        const algorithmLink = generateAlgorithmLink(selectedGuideline);

        // Return the relevant guidelines and associated algorithm link
        res.json({
            success: true,
            guidelines: relevantGuidelines,
            algorithmLink: algorithmLink
        });

    } catch (error) {
        console.error('Error in handleAction:', error);
        res.status(500).json({
            success: false,
            message: 'An error occurred while processing the request'
        });
    }
});

// Function to generate an algorithm link for a guideline
function generateAlgorithmLink(guideline) {
    // Convert PDF filename to HTML link format
    const htmlFilename = guideline.replace(/\.pdf$/i, '.html');
    return `https://iannouvel.github.io/clerky/algos/${encodeURIComponent(htmlFilename)}`;
}

// New endpoint for generating clinical notes
app.post('/generateFakeClinicalInteraction', authenticateUser, [
  body('prompt').trim().notEmpty().escape(),
], async (req, res) => {
  // Remove redundant CORS headers since we have global CORS configuration
  
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  const { prompt } = req.body;

  if (!prompt) {
    console.error('No prompt provided');
    return res.status(400).send('Prompt is required');
  }

  try {
    const response = await routeToAI(prompt, req.user.uid);
    
    // Log the response structure for debugging
    console.log('[DEBUG] generateFakeClinicalInteraction: AI response structure:', {
      hasResponse: !!response,
      responseKeys: response ? Object.keys(response) : 'no response',
      hasContent: !!response?.content,
      contentLength: response?.content?.length || 0,
      contentPreview: response?.content ? response.content.substring(0, 100) + '...' : 'NO CONTENT'
    });
    
    // Prepare the response to send to client
    const clientResponse = { success: true, response };
    
    console.log('[DEBUG] generateFakeClinicalInteraction: Client response structure:', {
      success: clientResponse.success,
      hasResponse: !!clientResponse.response,
      hasResponseContent: !!clientResponse.response?.content,
      responseContentLength: clientResponse.response?.content?.length || 0,
      fullResponseKeys: clientResponse.response ? Object.keys(clientResponse.response) : 'no response'
    });
    
    // Log the interaction
    try {
        await logAIInteraction({
            prompt,
            system_prompt: prompt
        }, {
            success: true,
            response
        }, 'generateFakeClinicalInteraction');
    } catch (logError) {
        console.error('Error logging interaction:', logError);
    }
    
    res.json(clientResponse);
  } catch (error) {
    console.error('Error in /generateFakeClinicalInteraction route:', error.message);
    
    // Log the error with the user's prompt
    try {
        await logAIInteraction({
            prompt,
            system_prompt: prompt
        }, {
            success: false,
            error: error.message
        }, 'generateFakeClinicalInteraction');
    } catch (logError) {
        console.error('Error logging failure:', logError);
    }
    
    res.status(500).json({ message: error.message });
  }
});

// New endpoint to handle action button functionality
app.post('/newActionEndpoint', authenticateUser, async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).send('Prompt is required');
    }

    try {
        // Load prompts configuration
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.guidelineApplicator.system_prompt;
        
        const response = await routeToAI(prompt, req.user.uid);
        
        // Log the interaction
        try {
            await logAIInteraction({
                prompt,
                system_prompt: systemPrompt
            }, {
                success: true,
                response
            }, 'newActionEndpoint');
        } catch (logError) {
            console.error('Error logging interaction:', logError);
        }
        
        res.json({ success: true, response });
    } catch (error) {
        console.error('Error in /newActionEndpoint route:', error.message);
        
        // Log the error with system prompt
        try {
            await logAIInteraction({
                prompt,
                system_prompt: prompts.guidelineApplicator.system_prompt
            }, {
                success: false,
                error: error.message
            }, 'newActionEndpoint');
        } catch (logError) {
            console.error('Error logging failure:', logError);
        }
        
        res.status(500).json({ message: error.message });
    }
});
// ============================================
// FIREBASE-BASED CLINICAL CONDITIONS MANAGEMENT
// ============================================
// Endpoint to get all clinical conditions with transcripts
app.get('/clinicalConditions', authenticateUser, async (req, res) => {
    try {
        console.log('[CLINICAL-CONDITIONS] Fetching all clinical conditions from Firebase...');
        
        const clinicalConditionsRef = admin.firestore().collection('clinicalConditions');
        const snapshot = await clinicalConditionsRef.get();
        
        const conditions = {};
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const category = data.category || 'uncategorized';
            
            if (!conditions[category]) {
                conditions[category] = {};
            }
            
            conditions[category][data.name] = {
                id: doc.id,
                name: data.name,
                category: data.category,
                transcript: data.transcript || null,
                lastGenerated: data.lastGenerated || null,
                hasTranscript: !!data.transcript,
                metadata: {
                    createdAt: data.createdAt,
                    updatedAt: data.updatedAt,
                    version: data.version || 1
                }
            };
        });
        
        console.log('[CLINICAL-CONDITIONS] Fetched conditions:', {
            totalCategories: Object.keys(conditions).length,
            totalConditions: Object.values(conditions).reduce((sum, category) => sum + Object.keys(category).length, 0),
            categoriesWithCounts: Object.fromEntries(
                Object.entries(conditions).map(([cat, conds]) => [cat, Object.keys(conds).length])
            )
        });
        
        res.json({
            success: true,
            conditions,
            summary: {
                totalCategories: Object.keys(conditions).length,
                totalConditions: Object.values(conditions).reduce((sum, category) => sum + Object.keys(category).length, 0),
                categoriesWithCounts: Object.fromEntries(
                    Object.entries(conditions).map(([cat, conds]) => [cat, Object.keys(conds).length])
                )
            }
        });
        
    } catch (error) {
        console.error('[CLINICAL-CONDITIONS] Error fetching clinical conditions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch clinical conditions',
            details: error.message
        });
    }
});

// Endpoint to generate/regenerate transcript for a specific condition
app.post('/generateTranscript/:conditionId', authenticateUser, async (req, res) => {
    try {
        const { conditionId } = req.params;
        const { forceRegenerate = false } = req.body;
        
        console.log('[GENERATE-TRANSCRIPT] Request for condition:', {
            conditionId,
            forceRegenerate,
            userId: req.user.uid
        });
        
        // Get the condition document from Firebase
        const conditionRef = admin.firestore().collection('clinicalConditions').doc(conditionId);
        const conditionDoc = await conditionRef.get();
        
        if (!conditionDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Clinical condition not found',
                conditionId
            });
        }
        
        const conditionData = conditionDoc.data();
        
        // Check if transcript already exists and we're not forcing regeneration
        if (conditionData.transcript && !forceRegenerate) {
            console.log('[GENERATE-TRANSCRIPT] Transcript already exists, returning cached version');
            return res.json({
                success: true,
                transcript: conditionData.transcript,
                cached: true,
                condition: {
                    id: conditionId,
                    name: conditionData.name,
                    category: conditionData.category
                },
                lastGenerated: conditionData.lastGenerated
            });
        }
        
        // Generate new transcript using AI
        console.log('[GENERATE-TRANSCRIPT] Generating new transcript...');
        
        // Load the test transcript prompt
        const testPrompt = createDefaultPrompts().testTranscript.prompt;
        const fullPrompt = testPrompt + conditionData.name;
        
        console.log('[GENERATE-TRANSCRIPT] Calling AI with prompt for condition:', conditionData.name);
        
        const aiResponse = await routeToAI(fullPrompt, req.user.uid);
        
        if (!aiResponse || !aiResponse.content) {
            throw new Error('Failed to generate transcript from AI');
        }
        
        const transcript = aiResponse.content;
        
        // Update the document in Firebase with the new transcript
        const updateData = {
            transcript: transcript,
            lastGenerated: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            version: admin.firestore.FieldValue.increment(1)
        };
        
        await conditionRef.update(updateData);
        
        console.log('[GENERATE-TRANSCRIPT] Successfully generated and saved transcript:', {
            conditionId,
            conditionName: conditionData.name,
            transcriptLength: transcript.length
        });
        
        res.json({
            success: true,
            transcript: transcript,
            cached: false,
            condition: {
                id: conditionId,
                name: conditionData.name,
                category: conditionData.category
            },
            generated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[GENERATE-TRANSCRIPT] Error generating transcript:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate transcript',
            details: error.message
        });
    }
});

// Endpoint to batch generate all missing transcripts
app.post('/generateAllTranscripts', authenticateUser, async (req, res) => {
    try {
        const { forceRegenerate = false, maxConcurrent = 3 } = req.body;
        
        console.log('[GENERATE-ALL] Starting batch transcript generation:', {
            forceRegenerate,
            maxConcurrent,
            userId: req.user.uid
        });
        
        // Get all clinical conditions
        const clinicalConditionsRef = admin.firestore().collection('clinicalConditions');
        const snapshot = await clinicalConditionsRef.get();
        
        if (snapshot.empty) {
            return res.json({
                success: true,
                message: 'No clinical conditions found to generate transcripts for',
                results: []
            });
        }
        
        const conditions = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            // Only include conditions that need transcripts
            if (!data.transcript || forceRegenerate) {
                conditions.push({
                    id: doc.id,
                    name: data.name,
                    category: data.category,
                    hasTranscript: !!data.transcript
                });
            }
        });
        
        if (conditions.length === 0) {
            return res.json({
                success: true,
                message: 'All clinical conditions already have transcripts',
                skipped: snapshot.size
            });
        }
        
        console.log('[GENERATE-ALL] Found conditions to generate:', {
            totalConditions: snapshot.size,
            needingGeneration: conditions.length,
            forceRegenerate
        });
        
        // Start the batch generation process (don't wait for completion)
        res.json({
            success: true,
            message: `Started batch generation for ${conditions.length} clinical conditions`,
            totalConditions: conditions.length,
            status: 'processing'
        });
        
        // Process conditions in batches (async, don't block response)
        processBatchGeneration(conditions, req.user.uid, maxConcurrent, forceRegenerate);
        
    } catch (error) {
        console.error('[GENERATE-ALL] Error starting batch generation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start batch transcript generation',
            details: error.message
        });
    }
});

// Helper function to process batch generation
async function processBatchGeneration(conditions, userId, maxConcurrent = 3, forceRegenerate = false) {
    console.log('[BATCH-GENERATION] Starting processing:', {
        totalConditions: conditions.length,
        maxConcurrent,
        forceRegenerate
    });
    
    const results = {
        successful: [],
        failed: [],
        skipped: []
    };
    
    // Load the test transcript prompt once
    const testPrompt = createDefaultPrompts().testTranscript.prompt;
    
    // Process conditions in chunks to limit concurrent AI calls
    for (let i = 0; i < conditions.length; i += maxConcurrent) {
        const chunk = conditions.slice(i, i + maxConcurrent);
        
        console.log('[BATCH-GENERATION] Processing chunk:', {
            chunkNumber: Math.floor(i / maxConcurrent) + 1,
            totalChunks: Math.ceil(conditions.length / maxConcurrent),
            chunkSize: chunk.length
        });
        
        // Process chunk concurrently
        const chunkPromises = chunk.map(async (condition) => {
            try {
                const fullPrompt = testPrompt + condition.name;
                
                console.log('[BATCH-GENERATION] Generating transcript for:', condition.name);
                
                const aiResponse = await routeToAI(fullPrompt, userId);
                
                if (!aiResponse || !aiResponse.content) {
                    throw new Error('Failed to generate transcript from AI');
                }
                
                const transcript = aiResponse.content;
                
                // Update the document in Firebase
                const conditionRef = admin.firestore().collection('clinicalConditions').doc(condition.id);
                await conditionRef.update({
                    transcript: transcript,
                    lastGenerated: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    version: admin.firestore.FieldValue.increment(1)
                });
                
                results.successful.push({
                    id: condition.id,
                    name: condition.name,
                    category: condition.category,
                    transcriptLength: transcript.length
                });
                
                console.log('[BATCH-GENERATION] Successfully generated transcript for:', condition.name);
                
            } catch (error) {
                console.error('[BATCH-GENERATION] Failed to generate transcript for:', condition.name, error);
                results.failed.push({
                    id: condition.id,
                    name: condition.name,
                    category: condition.category,
                    error: error.message
                });
            }
        });
        
        // Wait for chunk to complete before processing next chunk
        await Promise.allSettled(chunkPromises);
        
        // Add small delay between chunks to avoid overwhelming the AI service
        if (i + maxConcurrent < conditions.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    console.log('[BATCH-GENERATION] Batch generation completed:', {
        totalProcessed: conditions.length,
        successful: results.successful.length,
        failed: results.failed.length,
        skipped: results.skipped.length
    });
    
    // Could optionally store results or notify admin
    return results;
}

// Endpoint to initialize clinical conditions collection from JSON files
app.post('/initializeClinicalConditions', authenticateUser, async (req, res) => {
    try {
        console.log('[INIT-CONDITIONS] Initializing clinical conditions collection...');
        
        // Check if user has admin privileges (you might want to add admin check here)
        
        // Load clinical issues from the JSON file structure
        const fs = require('fs').promises;
        const path = require('path');
        
        const clinicalIssuesPath = path.join(__dirname, 'clinical_issues.json');
        const clinicalIssuesData = await fs.readFile(clinicalIssuesPath, 'utf8');
        const clinicalIssues = JSON.parse(clinicalIssuesData);
        
        const batch = admin.firestore().batch();
        const conditions = [];
        
        // Create documents for each clinical condition
        for (const [category, issues] of Object.entries(clinicalIssues)) {
            for (const issueName of issues) {
                const docId = `${category}-${issueName.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
                const docRef = admin.firestore().collection('clinicalConditions').doc(docId);
                
                const conditionData = {
                    name: issueName,
                    category: category,
                    transcript: null, // Will be generated on demand
                    lastGenerated: null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    version: 1
                };
                
                batch.set(docRef, conditionData);
                conditions.push({
                    id: docId,
                    name: issueName,
                    category: category
                });
            }
        }
        
        // Commit the batch
        await batch.commit();
        
        console.log('[INIT-CONDITIONS] Successfully initialized clinical conditions:', {
            totalConditions: conditions.length,
            categoriesWithCounts: Object.fromEntries(
                Object.entries(clinicalIssues).map(([cat, issues]) => [cat, issues.length])
            )
        });
        
        res.json({
            success: true,
            message: 'Clinical conditions collection initialized successfully',
            totalConditions: conditions.length,
            conditions: conditions,
            summary: {
                categories: Object.keys(clinicalIssues),
                categoriesWithCounts: Object.fromEntries(
                    Object.entries(clinicalIssues).map(([cat, issues]) => [cat, issues.length])
                )
            }
        });
        
    } catch (error) {
        console.error('[INIT-CONDITIONS] Error initializing clinical conditions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to initialize clinical conditions collection',
            details: error.message
        });
    }
});

// Function to check specific GitHub permissions
async function checkGitHubPermissions() {
    console.log('[DEBUG] checkGitHubPermissions: Starting GitHub permissions check...');
    
    try {
        const results = {
            repository: false,
            contents: false,
            workflows: false,
            actions: false,
            details: {}
        };

        console.log('[DEBUG] checkGitHubPermissions: Testing repository access...');
        // Test repository access
        try {
            const repoResponse = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 5000
            });
            results.repository = true;
            results.details.repository = repoResponse.data.permissions;
            console.log('[DEBUG] checkGitHubPermissions: Repository access ✅');
        } catch (error) {
            results.details.repository = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
            console.log('[DEBUG] checkGitHubPermissions: Repository access ❌', results.details.repository);
        }

        console.log('[DEBUG] checkGitHubPermissions: Testing contents access...');
        // Test contents access (try to list contents)
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 5000
            });
            results.contents = true;
            console.log('[DEBUG] checkGitHubPermissions: Contents access ✅');
        } catch (error) {
            results.details.contents = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
            console.log('[DEBUG] checkGitHubPermissions: Contents access ❌', results.details.contents);
        }

        console.log('[DEBUG] checkGitHubPermissions: Testing workflows access...');
        // Test workflows access
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 5000
            });
            results.workflows = true;
            console.log('[DEBUG] checkGitHubPermissions: Workflows access ✅');
        } catch (error) {
            results.details.workflows = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
            console.log('[DEBUG] checkGitHubPermissions: Workflows access ❌', results.details.workflows);
        }

        console.log('[DEBUG] checkGitHubPermissions: Testing actions access...');
        // Test actions access
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/runs`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 5000
            });
            results.actions = true;
            console.log('[DEBUG] checkGitHubPermissions: Actions access ✅');
        } catch (error) {
            results.details.actions = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
            console.log('[DEBUG] checkGitHubPermissions: Actions access ❌', results.details.actions);
        }

        console.log('[DEBUG] checkGitHubPermissions: Permissions check complete, results:', {
            allPermissionsGranted: Object.values(results).slice(0, 4).every(v => v),
            permissions: {
                repository: results.repository ? '✅' : '❌',
                contents: results.contents ? '✅' : '❌',
                workflows: results.workflows ? '✅' : '❌',
                actions: results.actions ? '✅' : '❌'
            }
        });

        return results;
    } catch (error) {
        console.error('[ERROR] checkGitHubPermissions: Error checking GitHub permissions:', error);
        return null;
    }
}

// Function to test GitHub token permissions
async function testGitHubAccess() {
    console.log('[DEBUG] testGitHubAccess: Starting GitHub access test...');
    console.log('[DEBUG] testGitHubAccess: Testing repository:', `${githubOwner}/${githubRepo}`);
    console.log('[DEBUG] testGitHubAccess: Token length:', githubToken ? githubToken.length : 'undefined');
    
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}`;
        console.log('[DEBUG] testGitHubAccess: Making request to:', url);
        
        const startTime = Date.now();
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            },
            timeout: 8000 // 8 second timeout
        });
        
        const duration = Date.now() - startTime;
        console.log('[DEBUG] testGitHubAccess: Request completed successfully in', duration, 'ms');
        console.log('[DEBUG] testGitHubAccess: Repository accessible, status:', response.status);
        return true;
    } catch (error) {
        console.error('[ERROR] testGitHubAccess: GitHub access test failed:', {
            status: error.response?.status,
            message: error.response?.data?.message,
            documentation_url: error.response?.data?.documentation_url,
            code: error.code,
            timeout: error.code === 'ECONNABORTED'
        });
        return false;
    }
}

// Update the saveToGitHub function with proper content handling and local fallback
async function saveToGitHub(content, type) {
    const MAX_RETRIES = 3;
    let attempt = 0;
    let success = false;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonFilename = `${timestamp}-${type}.json`;
    const jsonPath = `logs/ai-interactions/${jsonFilename}`;
    
    // Debug the input content
    console.log(`saveToGitHub called with type: ${type}`, {
        contentKeys: Object.keys(content),
        hasTextContent: 'textContent' in content,
        hasAiProvider: 'ai_provider' in content,
        githubTokenLength: githubToken ? githubToken.length : 0
    });
    
    // OPTIMISATION: Use minimal content instead of full interaction data
    const minimalContent = {
        ...summary,
        // Only include full data for critical failures or important interactions
        full_data: type.includes('error') || content.critical ? content : null
    };
    
    const jsonBody = {
        message: `Add ${type} summary: ${timestamp}`,
        content: Buffer.from(JSON.stringify(minimalContent, null, 2)).toString('base64'),
        branch: githubBranch
    };

    // OPTIMISATION: Create minimal log content instead of full text
    const summary = {
        type: type,
        timestamp: timestamp,
        ai_provider: content.ai_provider || 'unknown',
        ai_model: content.ai_model || 'unknown',
        endpoint: content.endpoint || 'unknown',
        token_usage: content.token_usage || null,
        prompt_length: content.prompt ? (typeof content.prompt === 'string' ? content.prompt.length : JSON.stringify(content.prompt).length) : 0,
        response_length: content.response ? (typeof content.response === 'string' ? content.response.length : JSON.stringify(content.response).length) : 0,
        // Store only first 200 chars of prompt/response for debugging
        prompt_preview: content.prompt ? (typeof content.prompt === 'string' ? content.prompt.substring(0, 200) : JSON.stringify(content.prompt).substring(0, 200)) + '...' : null,
        response_preview: content.response ? (typeof content.response === 'string' ? content.response.substring(0, 200) : JSON.stringify(content.response).substring(0, 200)) + '...' : null
    };
    
    console.log('Creating optimised log summary:', {
        type: summary.type,
        promptLength: summary.prompt_length,
        responseLength: summary.response_length,
        tokenUsage: summary.token_usage
    });

    // First, try saving to GitHub
    while (attempt < MAX_RETRIES && !success) {
        try {
            console.log(`saveToGitHub attempt ${attempt + 1}/${MAX_RETRIES} for ${type}...`);
            
            // Add delay between retries (except for first attempt)
            if (attempt > 0) {
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
                console.log(`Waiting ${delayMs}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            if (!githubToken) {
                console.error('GitHub token is missing, falling back to local save');
                break;
            }
            
            // OPTIMISATION: Skip .txt files, only save JSON to reduce GitHub storage by 50%
            console.log('Skipping .txt file creation to reduce GitHub storage load');

            const jsonUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${jsonPath}`;
            console.log(`Attempting to save JSON file to GitHub: ${jsonPath}`);
            const response = await axios.put(jsonUrl, jsonBody, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 30000, // 30 second timeout
                maxRetries: 0 // Disable axios retries, we handle our own
            });

            success = true;
            console.log(`Successfully saved ${type} to GitHub: ${jsonPath}`);
            console.log(`GitHub save completed after ${attempt + 1} attempt(s)`);
        } catch (error) {
            if (error.response?.status === 409) {
                console.log('Conflict detected, fetching latest SHA and retrying...');
                try {
                    const fileSha = await getFileSha(jsonPath);
                    if (fileSha) {
                        jsonBody.sha = fileSha;
                        console.log(`Updated JSON body with SHA: ${fileSha.substring(0, 8)}...`);
                        // Don't increment attempt counter for conflict resolution retry
                        // The attempt++ at the end of the loop will still happen, so we decrement here
                        attempt--;
                    } else {
                        console.error('Could not retrieve SHA for conflict resolution');
                    }
                } catch (shaError) {
                    console.error('Error getting file SHA for conflict resolution:', {
                        message: shaError.message,
                        status: shaError.response?.status,
                        errorType: shaError.constructor.name
                    });
                }
            } else {
                // Properly stringify error information for logging
                const errorInfo = {
                    status: error.response?.status || 'No status',
                    message: error.response?.data?.message || error.message || 'No message',
                    documentation_url: error.response?.data?.documentation_url || 'No URL',
                    requestUrl: error.config?.url || 'No URL',
                    errorType: error.constructor.name,
                    stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'No stack',
                    requestHeaders: error.config?.headers ? 
                        { ...error.config.headers, Authorization: 'token [REDACTED]' } : 
                        'No headers'
                };
                
                console.error(`Error saving ${type} to GitHub (attempt ${attempt + 1}/${MAX_RETRIES}):`, JSON.stringify(errorInfo, null, 2));
                
                // On the last retry, try writing to a local file as fallback
                if (attempt === MAX_RETRIES - 1) {
                    try {
                        console.log('Trying local file fallback...');
                        // Create logs directory if it doesn't exist
                        const localLogsDir = './logs/local-ai-interactions';
                        if (!fs.existsSync(localLogsDir)) {
                            fs.mkdirSync(localLogsDir, { recursive: true });
                            console.log(`Created local logs directory: ${localLogsDir}`);
                        }
                        
                        // OPTIMISATION: Write only optimised JSON file locally
                        const localJsonPath = `${localLogsDir}/${timestamp}-${type}.json`;
                        fs.writeFileSync(localJsonPath, JSON.stringify(minimalContent, null, 2));
                        console.log(`Saved optimised log locally to ${localJsonPath}`);
                        
                        success = true; // Consider this a success since we saved it locally
                        break;
                    } catch (localError) {
                        console.error('Failed to save logs locally:', localError);
                    }
                }
            }
        }
        attempt++;
    }

    // If GitHub and local file save both failed, throw an error
    if (!success) {
        throw new Error(`Failed to save ${type} after ${MAX_RETRIES} attempts.`);
    }
    
    return success;
}
// Fix the AI info extraction in logAIInteraction
async function logAIInteraction(prompt, response, endpoint) {
  try {
    // OPTIMISATION: Only log important interactions to reduce GitHub load
    const importantEndpoints = [
      'submit', 'reply', 'findRelevantGuidelines', 'checkAgainstGuidelines', 
      'generateClinicalNote', 'error', 'failure'
    ];
    
    const shouldLog = importantEndpoints.some(important => endpoint.includes(important)) || 
                      (response && response.error) || 
                      (response && response.critical);
    
    if (!shouldLog) {
      console.log(`Skipping log for non-critical endpoint: ${endpoint}`);
      return true;
    }
    
    // Log the raw inputs for debugging
    console.log('logAIInteraction called with:', JSON.stringify({
      promptType: typeof prompt,
      responseType: typeof response,
      endpoint,
      responseKeys: response ? Object.keys(response) : 'no response'
    }, null, 2));
    
    // Get current timestamp in ISO format for filenames
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
    
    // Clean prompt for logging
    let cleanedPrompt = prompt;
    if (typeof prompt === 'object') {
      cleanedPrompt = JSON.stringify(prompt, null, 2);
    }
    
    // Clean response for logging
    let cleanedResponse = '';
    let ai_provider = 'DeepSeek'; // Default to DeepSeek
    let ai_model = 'deepseek-chat'; // Default model
    let token_usage = null; // Initialize token usage
    
    // Print a deep inspection of the response object for debugging
    console.log('Full response structure:', JSON.stringify(response, null, 2));
    
    // Extract AI information if it exists in the response
    if (response && typeof response === 'object') {
      console.log('Response object structure:', JSON.stringify({
        hasContent: 'content' in response,
        hasResponse: 'response' in response,
        hasAIProvider: 'ai_provider' in response,
        hasTokenUsage: 'token_usage' in response,
        hasNestedAIProvider: response.response && typeof response.response === 'object' && 'ai_provider' in response.response
      }, null, 2));
      
      // Extract token usage if available
      if (response.token_usage) {
        token_usage = response.token_usage;
        console.log('Logging token usage:', token_usage);
      } else if (response.response && response.response.token_usage) {
        token_usage = response.response.token_usage;
        console.log('Logging nested token usage:', token_usage);
      }
      
      // If response has ai_provider and ai_model directly
      if (response.ai_provider) {
        ai_provider = response.ai_provider;
        ai_model = response.ai_model || (ai_provider === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat');
      } 
      // If response has nested response property with ai info
      else if (response.response && typeof response.response === 'object') {
        if (response.response.ai_provider) {
          ai_provider = response.response.ai_provider;
          ai_model = response.response.ai_model || (ai_provider === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat');
        }
      }
      
      // Extract the actual content from the response structure
      // Handle endpoint-specific response formats
      if (endpoint === 'handleGuidelines' || endpoint === 'handleIssues') {
        // For these endpoints, the actual content is likely in response.response
        if (response.success === true && response.response) {
          // response.response could be a string or array of strings
          if (typeof response.response === 'string') {
            cleanedResponse = response.response;
          } else if (Array.isArray(response.response)) {
            cleanedResponse = response.response.join('\n');
          } else if (typeof response.response === 'object') {
            // If it's an object, we may need to extract specific fields or stringify it
            if ('content' in response.response) {
              cleanedResponse = response.response.content;
            } else if ('text' in response.response) {
              cleanedResponse = response.response.text;
            } else if ('message' in response.response) {
              cleanedResponse = response.response.message;
            } else if ('guidelines' in response.response) {
              cleanedResponse = Array.isArray(response.response.guidelines) 
                ? response.response.guidelines.join('\n')
                : response.response.guidelines;
            } else if ('issues' in response.response) {
              cleanedResponse = Array.isArray(response.response.issues) 
                ? response.response.issues.join('\n')
                : response.response.issues;
            } else {
              // If we can't identify a specific field, stringify the whole object
              cleanedResponse = JSON.stringify(response.response, null, 2);
            }
          }
        }
      } else {
        // For other endpoints, try standard content extraction
        if (response.content) {
          cleanedResponse = response.content;
        } else if (response.response && typeof response.response === 'string') {
          cleanedResponse = response.response;
        } else if (response.response && response.response.content) {
          cleanedResponse = response.response.content;
        } else if (response.text) {
          cleanedResponse = response.text;
        } else if (response.response && response.response.text) {
          cleanedResponse = response.response.text;
        } else if (typeof response === 'string') {
          cleanedResponse = response;
        } else if (typeof response === 'object') {
          // Last resort - stringify the whole object
          cleanedResponse = JSON.stringify(response, null, 2);
        }
      }
    }
    
    // Ensure cleanedResponse is not empty
    if (!cleanedResponse || cleanedResponse.trim() === '') {
      cleanedResponse = '[Empty response or response extraction failed]';
    }
    
    // Create log entry with AI provider info
    const ai_info = `AI: ${ai_provider} (${ai_model})`;
    console.log('Logging AI interaction:', JSON.stringify({ endpoint, ai_info }, null, 2));
    
    // Prepare content for text files
    let textContent = '';
    
    // If it's a submission/prompt, format it differently
    if (endpoint.includes('submit') || endpoint === 'generateClinicalNote' || endpoint === 'generateSummary') {
      textContent = `${ai_info}\n\n${cleanedPrompt}`;
    } else {
      // For replies, format as Q&A
      textContent = `${ai_info}\n\nQ: ${cleanedPrompt}\n\nA: ${cleanedResponse}`;
      
      // Add token usage information if available
      if (token_usage) {
        const { prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd } = token_usage;
        const cost = estimated_cost_usd ? `$${estimated_cost_usd.toFixed(6)}` : 'Not available';
        
        textContent += `\n\n--- Token Usage Report ---\nPrompt tokens: ${prompt_tokens || 'N/A'}\nCompletion tokens: ${completion_tokens || 'N/A'}\nTotal tokens: ${total_tokens || 'N/A'}\nEstimated cost: ${cost}`;
      }
    }
    
    // Debug the content we're about to save
    console.log(`Prepared log content for ${endpoint}:`, {
      contentLength: textContent.length,
      ai_provider,
      ai_model,
      hasTokenUsage: !!token_usage,
      hasGithubToken: !!process.env.GITHUB_TOKEN,
      extractedResponse: cleanedResponse.substring(0, 100) + (cleanedResponse.length > 100 ? '...' : '')
    });
    
    // Save to GitHub repository
    try {
      await saveToGitHub({
        prompt: prompt,
        response: cleanedResponse,
        endpoint: endpoint,
        timestamp: timestamp,
        ai_provider: ai_provider,
        ai_model: ai_model,
        token_usage: token_usage,
        // Mark as critical if it's an error or failure
        critical: endpoint.includes('error') || endpoint.includes('failure') || (response && response.error)
      }, endpoint.includes('submit') ? 'submission' : 'reply');
      
      console.log(`Successfully logged AI interaction for endpoint: ${endpoint}`);
      return true;
    } catch (saveError) {
      console.error('Error in saveToGitHub during logAIInteraction:', {
        message: saveError.message,
        errorType: saveError.constructor.name,
        stack: saveError.stack ? saveError.stack.split('\n').slice(0, 5).join('\n') : 'No stack',
        endpoint,
        timestamp,
        response: saveError.response ? {
          status: saveError.response.status,
          statusText: saveError.response.statusText,
          data: JSON.stringify(saveError.response.data).substring(0, 500)
        } : 'No response data'
      });
      
      // Try a direct local save as last resort
      try {
        console.log('Attempting emergency local save...');
        const localLogsDir = './logs/emergency-logs';
        if (!fs.existsSync(localLogsDir)) {
          fs.mkdirSync(localLogsDir, { recursive: true });
          console.log(`Created emergency logs directory: ${localLogsDir}`);
        }
        
        const emergencyLogPath = `${localLogsDir}/${timestamp}-${endpoint}-emergency.txt`;
        fs.writeFileSync(emergencyLogPath, textContent);
        console.log(`Saved emergency log to: ${emergencyLogPath}`);
        
        const emergencyJsonPath = `${localLogsDir}/${timestamp}-${endpoint}-emergency.json`;
        fs.writeFileSync(emergencyJsonPath, JSON.stringify({
          prompt,
          response: cleanedResponse,
          endpoint,
          ai_provider,
          ai_model,
          token_usage
        }, null, 2));
        console.log(`Saved emergency JSON to: ${emergencyJsonPath}`);
        
        return true;
      } catch (emergencyError) {
        console.error('Failed to save emergency logs:', emergencyError);
        
        // Last resort: dump to console
        console.log('EMERGENCY LOG DUMP:');
        console.log('-------------------');
        console.log(textContent);
        console.log('-------------------');
        
        return false;
      }
    }
  } catch (error) {
    console.error('Unexpected error in logAIInteraction:', error);
    // Dump content to console as absolute last resort
    try {
      console.log('CRITICAL ERROR LOG DUMP:');
      console.log('------------------------');
      console.log(`PROMPT: ${typeof prompt === 'object' ? JSON.stringify(prompt) : prompt}`);
      console.log(`RESPONSE: ${typeof response === 'object' ? JSON.stringify(response) : response}`);
      console.log('------------------------');
    } catch (e) {
      console.error('Failed even to dump log to console:', e);
    }
    return false;
  }
}

// Update the handleIssues endpoint to use system prompt
app.post('/handleIssues', authenticateUser, async (req, res) => {
    const { prompt } = req.body;

    //console.log('\n=== handleIssues Request ===');
    //console.log('Full prompt text:');
    //console.log(prompt);
    //console.log('\n=== End Request ===\n');

    if (!prompt) {
        //console.log('Error: No prompt provided');
        return res.status(400).json({
            success: false,
            message: 'Prompt is required'
        });
    }

    try {
        // Load prompts configuration
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.issues.system_prompt;
        const enhancedPrompt = `${prompt}`;
        
        const aiResponse = await routeToAI(enhancedPrompt, req.user.uid);
        
        // Extract content from the response if it's an object
        const responseText = aiResponse && typeof aiResponse === 'object' 
            ? aiResponse.content 
            : aiResponse;
            
        if (!responseText) {
            throw new Error('Invalid response format from AI service');
        }
        
        // Log the interaction
        try {
            await logAIInteraction({
                prompt: enhancedPrompt,
                system_prompt: systemPrompt
            }, {
                success: true,
                response: aiResponse
            }, 'handleIssues');
        } catch (logError) {
            console.error('Error logging interaction:', logError);
        }

        const issues = responseText
            .split('\n')
            .map(issue => issue.trim())
            .filter(issue => issue && issue.length > 0)
            .filter((issue, index, self) => 
                index === self.findIndex(t => 
                    t.toLowerCase().includes(issue.toLowerCase()) ||
                    issue.toLowerCase().includes(t.toLowerCase())
                )
            );

        if (issues.length === 0) {
            res.json({ 
                success: true, 
                issues: [], 
                message: 'No significant clinical issues identified' 
            });
        } else {
            res.json({ success: true, issues });
        }
    } catch (error) {
        console.error('Error in /handleIssues:', error);
        
        try {
            await logAIInteraction({
                prompt,
                system_prompt: prompts.issues.system_prompt
            }, {
                success: false,
                error: error.message
            }, 'handleIssues');
        } catch (logError) {
            console.error('Error logging failure:', logError);
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to process the summary text',
            error: error.message,
            details: error.response?.data || 'No additional details available'
        });
    }
});

// Update the SendToAI endpoint to use system prompt
app.post('/SendToAI', authenticateUser, async (req, res) => {
    const { prompt, selectedGuideline, comments } = req.body;
    const filePath = `algos/${selectedGuideline}`;

    if (!prompt || !selectedGuideline) {
        return res.status(400).send('Prompt and selected guideline are required');
    }

    try {
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.clinicalNote.prompt;
        const condensedText = await fetchCondensedFile(selectedGuideline);
        const finalPrompt = `
            The following is HTML code for a clinical algorithm based on the guideline:
            ${condensedText}

            Here are additional comments provided by the user: ${comments}

            Please maintain the previously used web page structure: with two columns, variables on the left and guidance on the right.
            The HTML previously generated was the result of code which automates the transformation of clinical guidelines from static PDF documents into a dynamic, interactive web tool.`;

        const generatedHtml = await routeToAI(finalPrompt, req.user.uid);
        
        // Extract content from the response if it's an object
        const htmlContent = generatedHtml && typeof generatedHtml === 'object' 
            ? generatedHtml.content 
            : generatedHtml;
            
        if (!htmlContent) {
            throw new Error('Invalid response format from AI service');
        }

        // Log the interaction
        await logAIInteraction({
            prompt: finalPrompt,
            selectedGuideline,
            comments,
            system_prompt: systemPrompt
        }, {
            success: true,
            generatedHtml: htmlContent.substring(0, 500) + '...' // Log first 500 chars only
        }, 'SendToAI');

        if (isValidHTML(htmlContent)) {
            const fileSha = await getFileSha(filePath);
            const commit = await updateHtmlFileOnGitHub(filePath, htmlContent, fileSha);
            res.json({ message: 'HTML file updated successfully', commit });
        } else {
            res.status(400).json({ message: 'The generated content is not valid HTML.' });
        }
    } catch (error) {
        console.error('Error in SendToAI route:', error.message);
        
        // Log the error
        await logAIInteraction({
            prompt,
            selectedGuideline,
            comments,
            system_prompt: prompts.clinicalNote.prompt
        }, {
            success: false,
            error: error.message
        }, 'SendToAI');
        
        res.status(500).json({ message: error.message });
    }
});

// Helper function to create prompt for a chunk of guidelines
function createPromptForChunk(transcript, guidelinesChunk) {
    // Enhanced guideline formatting with more comprehensive information
    const guidelinesText = guidelinesChunk.map(g => {
        let guidelineInfo = `[${g.id}] ${g.title}`;
        
        // Add summary if available
        if (g.summary && g.summary.trim()) {
            guidelineInfo += `\nSummary: ${g.summary.trim()}`;
        }
        
        // Add condensed content preview if available (first 300 chars)
        if (g.condensed && g.condensed.trim()) {
            const condensedPreview = g.condensed.trim().substring(0, 300);
            guidelineInfo += `\nKey Content: ${condensedPreview}${g.condensed.length > 300 ? '...' : ''}`;
        }
        
        // Add keywords if available
        if (g.keywords && Array.isArray(g.keywords) && g.keywords.length > 0) {
            guidelineInfo += `\nKeywords: ${g.keywords.join(', ')}`;
        } else if (g.keywords && typeof g.keywords === 'string' && g.keywords.trim()) {
            guidelineInfo += `\nKeywords: ${g.keywords.trim()}`;
        }
        
        return guidelineInfo;
    }).join('\n\n---\n\n');

    return `You are a medical expert analyzing a clinical case to identify the most relevant medical guidelines. Your task is to categorize each guideline by its clinical relevance to the specific patient scenario.

CLINICAL CASE:
${transcript}

AVAILABLE GUIDELINES:
${guidelinesText}

ANALYSIS INSTRUCTIONS:
1. Carefully read the clinical case and identify the key clinical issues, patient demographics, and medical context
2. For each guideline, consider:
   - Direct relevance to the patient's primary presenting conditions
   - Applicability to the patient's specific demographics (age, pregnancy status, etc.)
   - Relevance to secondary issues or comorbidities mentioned
   - Potential value for differential diagnosis or management planning
   - Appropriateness for the clinical setting and care level described

RELEVANCE SCORING (0.0-1.0):
- 0.9-1.0: Directly addresses primary clinical issues and patient context
- 0.7-0.89: Highly relevant to primary or important secondary issues  
- 0.5-0.69: Moderately relevant to secondary issues or differential diagnosis
- 0.2-0.49: Limited relevance, may provide background information
- 0.0-0.19: Minimal or no relevance to this specific case

RESPONSE FORMAT (JSON only):
{
  "mostRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "potentiallyRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "lessRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}],
  "notRelevant": [{"id": "guideline_id", "title": "guideline_title", "relevance": "0.XX"}]
}

Provide ONLY the JSON response with no additional text or explanation.`;
}

// Helper function to merge chunk results
function mergeChunkResults(chunkResults) {
    const merged = {
        mostRelevant: [],
        potentiallyRelevant: [],
        lessRelevant: [],
        notRelevant: []
    };
    
    chunkResults.forEach(result => {
        if (result && result.categories) {
            Object.keys(merged).forEach(category => {
                if (result.categories[category] && Array.isArray(result.categories[category])) {
                    merged[category].push(...result.categories[category]);
                }
            });
        }
    });
    
    // Collect all guidelines from all categories into a single array for score-based re-categorization
    const allGuidelines = [];
    Object.keys(merged).forEach(category => {
        merged[category].forEach(guideline => {
            allGuidelines.push({ ...guideline, originalCategory: category });
        });
    });
    
    // Clear the original categories
    merged.mostRelevant = [];
    merged.potentiallyRelevant = [];
    merged.lessRelevant = [];
    merged.notRelevant = [];
    
    // Re-categorize based on actual relevance scores to fix AI categorization errors
    allGuidelines.forEach(guideline => {
        const score = parseFloat(guideline.relevance) || 0;
        
        // Define score thresholds for proper categorization
        if (score >= 0.8) {
            merged.mostRelevant.push(guideline);
        } else if (score >= 0.6) {
            merged.potentiallyRelevant.push(guideline);
        } else if (score >= 0.3) {
            merged.lessRelevant.push(guideline);
        } else {
            merged.notRelevant.push(guideline);
        }
    });
    
    // Sort each category by relevance score (descending order)
    Object.keys(merged).forEach(category => {
        merged[category].sort((a, b) => {
            const aScore = parseFloat(a.relevance) || 0;
            const bScore = parseFloat(b.relevance) || 0;
            return bScore - aScore; // Descending order
        });
    });
    
    // Log the re-categorization for debugging
    console.log('[DEBUG] Re-categorized guidelines based on scores:', {
        mostRelevant: merged.mostRelevant.length,
        potentiallyRelevant: merged.potentiallyRelevant.length,
        lessRelevant: merged.lessRelevant.length,
        notRelevant: merged.notRelevant.length,
        scoreRanges: {
            mostRelevant: merged.mostRelevant.map(g => parseFloat(g.relevance)).join(', '),
            potentiallyRelevant: merged.potentiallyRelevant.map(g => parseFloat(g.relevance)).join(', '),
            lessRelevant: merged.lessRelevant.map(g => parseFloat(g.relevance)).join(', '),
            notRelevant: merged.notRelevant.map(g => parseFloat(g.relevance)).join(', ')
        }
    });
    
    return merged;
}

// Helper function to parse AI response for chunk
function parseChunkResponse(responseContent, originalChunk = []) {
    try {
        // Clean up the response content first
        let cleanContent = responseContent.trim();
        
        // Try to extract JSON from markdown code blocks
        const jsonMatch = cleanContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
        if (jsonMatch) {
            cleanContent = jsonMatch[1];
            console.log('[DEBUG] Extracted JSON from markdown code block');
        }
        
        // Try to parse as JSON first
        const parsed = JSON.parse(cleanContent);
        console.log('[DEBUG] JSON parsing successful');
        
        // Ensure all guidelines have proper IDs (use document ID, not guidelineId)
        const cleanedCategories = {};
        const originalTitles = originalChunk.map(g => g.title);

        Object.keys(parsed).forEach(category => {
            cleanedCategories[category] = (parsed[category] || []).map(item => {
                if (!item.title) {
                    return { id: 'unknown-no-title', title: 'Unknown Title', relevance: item.relevance || '0.0' };
                }
                
                // Find the best match for the AI-returned title in our original list
                const { bestMatch } = stringSimilarity.findBestMatch(item.title, originalTitles);

                // Use a threshold to ensure the match is good enough
                if (bestMatch.rating > 0.7) { 
                    const guideline = originalChunk.find(g => g.title === bestMatch.target);
                    if (guideline) {
                        console.log(`[DEBUG] Found guideline by fuzzy title match: "${item.title}" -> ${guideline.id} (Rating: ${bestMatch.rating.toFixed(2)})`);
                        
                        // Return the matched guideline with preserved fields and relevance
                        return {
                            ...guideline, // Preserve all original fields including downloadUrl
                            relevance: item.relevance || '0.5' // Use item's relevance or default
                        };
                    }
                }
                
                // If no match found, return the item with a warning
                console.log(`[DEBUG] Could not match AI guideline to original: "${item.title}"`);
                return {
                    id: item.id || 'unknown-id',
                    title: item.title,
                    relevance: item.relevance || '0.0'
                };
            });
        });
        
        console.log('[DEBUG] JSON parsing completed successfully');
        
        return { success: true, categories: cleanedCategories };
    } catch (jsonError) {
        console.log('[DEBUG] JSON parsing failed:', {
            error: jsonError.message,
            responsePreview: responseContent.substring(0, 200) + '...',
            responseLength: responseContent.length
        });
        
        // Fallback to text parsing with original chunk data for ID mapping
        const categories = {
            mostRelevant: [],
            potentiallyRelevant: [],
            lessRelevant: [],
            notRelevant: []
        };
        
        const lines = responseContent.split('\n');
        let currentCategory = null;
        let parsedCount = 0;
        
        console.log('[DEBUG] Attempting text parsing on', lines.length, 'lines with', originalChunk.length, 'original guidelines');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Check for category headers
            if (trimmed.toLowerCase().includes('most relevant') || trimmed.includes('mostRelevant')) {
                currentCategory = 'mostRelevant';
                console.log('[DEBUG] Found category: mostRelevant');
            } else if (trimmed.toLowerCase().includes('potentially relevant') || trimmed.includes('potentiallyRelevant')) {
                currentCategory = 'potentiallyRelevant';
                console.log('[DEBUG] Found category: potentiallyRelevant');
            } else if (trimmed.toLowerCase().includes('less relevant') || trimmed.includes('lessRelevant')) {
                currentCategory = 'lessRelevant';
                console.log('[DEBUG] Found category: lessRelevant');
            } else if (trimmed.toLowerCase().includes('not relevant') || trimmed.includes('notRelevant')) {
                currentCategory = 'notRelevant';
                console.log('[DEBUG] Found category: notRelevant');
            }
            
            if (currentCategory) {
                let guideline = null;
                let relevance = '0.5';
                
                // Method 1 (New): Fuzzy match the title from the line against original titles
                const potentialTitle = trimmed.replace(/\[.*?\]/, '').replace(/^[\-\*\d\.\s:]+/, '').split(':')[0].trim();
                const originalTitles = originalChunk.map(g => g.title);
                const { bestMatch } = stringSimilarity.findBestMatch(potentialTitle, originalTitles);

                // Use a threshold to ensure the match is good enough
                if (bestMatch.rating > 0.7) { 
                    guideline = originalChunk.find(g => g.title === bestMatch.target);
                    console.log(`[DEBUG] Found guideline by fuzzy title match: "${potentialTitle}" -> ${guideline.id} (Rating: ${bestMatch.rating.toFixed(2)})`);
                }
                
                // Extract relevance score
                const relevanceMatch = trimmed.match(/(\d*\.?\d+)/);
                if (relevanceMatch) {
                    relevance = relevanceMatch[1];
                }
                
                // Add to category if we found a match
                if (guideline) {
                    categories[currentCategory].push({
                        ...guideline, // Preserve all original fields including downloadUrl
                        relevance: relevance // Override with extracted relevance
                    });
                    
                    parsedCount++;
                    console.log(`[DEBUG] Parsed guideline: ${guideline.id} -> ${currentCategory} (${relevance})`);
                } else if (trimmed.length > 10 && !trimmed.toLowerCase().includes('relevant')) {
                    // Log failed matches for debugging
                    console.log(`[DEBUG] Could not match line to any guideline: "${trimmed.substring(0, 50)}..."`);
                }
            }
        }
        
        console.log('[DEBUG] Text parsing completed:', {
            totalParsed: parsedCount,
            totalOriginal: originalChunk.length,
            categoryCounts: Object.keys(categories).map(cat => `${cat}: ${categories[cat].length}`).join(', ')
        });
        
        return { success: true, categories };
    }
}
// Main findRelevantGuidelines endpoint with concurrent chunking
app.post('/findRelevantGuidelines', authenticateUser, async (req, res) => {
  try {
    const { transcript, guidelinesPayload, anonymisationInfo } = req.body;
    const userId = req.user.uid;
    
    // Handle optimized guidelines payload
    let guidelines = [];
    if (guidelinesPayload) {
      // If we have an optimized payload, reconstruct the full guidelines array
      console.log('[CACHE] Processing optimized guidelines payload:', {
        newGuidelines: guidelinesPayload.newGuidelines?.length || 0,
        updatedGuidelines: guidelinesPayload.updatedGuidelines?.length || 0,
        hasFullCache: guidelinesPayload.hasFullCache,
        totalCount: guidelinesPayload.totalCount
      });
      
      if (guidelinesPayload.hasFullCache) {
        // Client has cache, only new/updated guidelines sent
        guidelines = [...(guidelinesPayload.newGuidelines || []), ...(guidelinesPayload.updatedGuidelines || [])];
        
        // If we only have partial data, we need to get full guidelines from Firestore
        if (guidelines.length < guidelinesPayload.totalCount) {
          console.log('[CACHE] Partial payload received, loading full guidelines from Firestore...');
                     const fullGuidelines = await getAllGuidelines();
          guidelines = fullGuidelines;
        }
      } else {
        // No cache, all guidelines should be in newGuidelines
        guidelines = guidelinesPayload.newGuidelines || [];
      }
    } else {
      // Fallback: load guidelines from Firestore if no payload
      console.log('[CACHE] No guidelines payload, loading from Firestore...');
             guidelines = await getAllGuidelines();
    }
    
    // Log anonymisation information if provided
    if (anonymisationInfo) {
      console.log('[ANONYMISER] Server received anonymised data:', {
        originalLength: anonymisationInfo.originalLength,
        anonymisedLength: anonymisationInfo.anonymisedLength,
        replacementsCount: anonymisationInfo.replacementsCount,
        riskLevel: anonymisationInfo.riskLevel,
        piiTypes: anonymisationInfo.piiTypes
      });
    }
    
    console.log(`[DEBUG] Processing ${guidelines.length} guidelines in chunks`);
    
    // Configuration - reduced chunk size due to enhanced guideline information
    const CHUNK_SIZE = 8; // Safe token limit per chunk with enhanced prompts
    const chunks = [];
    
    // Split guidelines into chunks
    for (let i = 0; i < guidelines.length; i += CHUNK_SIZE) {
        chunks.push(guidelines.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`[DEBUG] Created ${chunks.length} chunks of max ${CHUNK_SIZE} guidelines each`);
    
    // Process all chunks concurrently
    const chunkPromises = chunks.map(async (chunk, index) => {
        try {
            console.log(`[DEBUG] Processing chunk ${index + 1}/${chunks.length} with ${chunk.length} guidelines`);
            
            const prompt = createPromptForChunk(transcript, chunk);
            const aiResponse = await routeToAI(prompt, userId);
            
            // Extract content from the response
            const responseContent = aiResponse && typeof aiResponse === 'object' 
                ? aiResponse.content 
                : aiResponse;
                
            if (!responseContent) {
                throw new Error(`Invalid response format from AI service for chunk ${index + 1}`);
            }
            
            // Log each chunk's AI response for debugging
            console.log(`[DEBUG] Chunk ${index + 1} AI Response:`, JSON.stringify({
                responseType: typeof responseContent,
                responseLength: responseContent.length,
                responsePreview: responseContent.substring(0, 500) + (responseContent.length > 500 ? '...' : ''),
                fullResponse: responseContent
            }, null, 2));
            
            // Log the interaction for this chunk
            try {
                await logAIInteraction({
                    prompt: `Chunk ${index + 1}/${chunks.length}`,
                    transcriptLength: transcript.length,
                    transcriptPreview: transcript.substring(0, 500) + '...',
                    chunkGuidelines: chunk.map(g => `${g.id}: ${g.title}`),
                    chunkIndex: index + 1,
                    totalChunks: chunks.length
                }, {
                    success: true,
                    aiResponse: responseContent,
                    responseType: typeof responseContent,
                    responseLength: responseContent.length
                }, `findRelevantGuidelines-chunk-${index + 1}`);
            } catch (logError) {
                console.error(`Error logging chunk ${index + 1} interaction:`, logError);
            }
            
            const parseResult = parseChunkResponse(responseContent, chunk);
            console.log(`[DEBUG] Chunk ${index + 1} parse result:`, {
                success: parseResult.success,
                categoriesFound: Object.values(parseResult.categories || {}).flat().length,
                categories: parseResult.categories
            });
            
            return parseResult;
        } catch (error) {
            console.error(`[ERROR] Error processing chunk ${index + 1}:`, error);
            return { 
                success: false, 
                error: error.message,
                categories: { mostRelevant: [], potentiallyRelevant: [], lessRelevant: [], notRelevant: [] }
            };
        }
    });
    
    // Wait for all chunks to complete
    const chunkResults = await Promise.allSettled(chunkPromises);
    
    // Process results
    const successfulResults = chunkResults
        .filter(result => result.status === 'fulfilled' && result.value.success)
        .map(result => result.value);
        
    const failedChunks = chunkResults
        .filter(result => result.status === 'rejected' || !result.value.success)
        .length;
    
    console.log(`[DEBUG] Processed ${successfulResults.length}/${chunks.length} chunks successfully`);
    
    if (successfulResults.length === 0) {
        throw new Error('All chunks failed to process');
    }
    
    // Merge all categorized results
    const mergedCategories = mergeChunkResults(successfulResults);
    
    // Log the interaction
    try {
        await logAIInteraction({
            transcript,
            guidelinesCount: guidelines.length,
            chunksProcessed: successfulResults.length,
            chunksFailed: failedChunks
        }, {
            success: true,
            categoriesFound: Object.values(mergedCategories).flat().length,
            mostRelevantCount: mergedCategories.mostRelevant.length,
            potentiallyRelevantCount: mergedCategories.potentiallyRelevant.length,
            lessRelevantCount: mergedCategories.lessRelevant.length,
            notRelevantCount: mergedCategories.notRelevant.length
        }, 'findRelevantGuidelines');
    } catch (logError) {
        console.error('Error logging interaction:', logError);
    }

    res.json({ 
        success: true, 
        categories: mergedCategories,
        chunksProcessed: successfulResults.length,
        totalChunks: chunks.length
    });
    
  } catch (error) {
    console.error('[ERROR] Error in findRelevantGuidelines:', error);
    
    // Log the error
    try {
        await logAIInteraction({
            transcript: req.body.transcript,
            guidelinesCount: req.body.guidelines?.length || 0
        }, {
            success: false,
            error: error.message
        }, 'findRelevantGuidelines');
    } catch (logError) {
        console.error('Error logging failure:', logError);
    }
    
    res.status(500).json({ 
        success: false, 
        error: `AI request failed: ${error.message}` 
    });
  }
});

async function checkFolderExists(folderPath) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${folderPath}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return true;
    } catch (error) {
        if (error.response?.status === 404) {
            //console.log('Folder does not exist:', folderPath);
            return false;
        }
        console.error('Error checking folder:', error);
        throw error;
    }
}

// Function to verify if a file path exists on GitHub
async function verifyFilePath(filePath) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}?ref=${githubBranch}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return true;
    } catch (error) {
        if (error.response?.status === 404) {
            console.error('File not found:', filePath);
            return false;
        }
        console.error('Error verifying file path:', error);
        throw error;
    }
}

// Helper function to calculate file hash
async function calculateFileHash(fileBuffer) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(fileBuffer);
    return hash.digest('hex');
}

// Endpoint to check for duplicate files
app.post('/checkDuplicateFiles', authenticateUser, async (req, res) => {
    try {
        const { hashes } = req.body;
        
        if (!hashes || !Array.isArray(hashes)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid hashes array provided' 
            });
        }

        console.log(`[DUPLICATE_CHECK] Checking ${hashes.length} file hashes for duplicates`);
        
        // Extract hash strings from the request
        const hashStrings = hashes.map(h => h.hash);
        const duplicates = [];
        
        // Get current GitHub guidelines list for validation
        let githubGuidelines = [];
        try {
            githubGuidelines = await getGuidelinesList();
            console.log(`[DUPLICATE_CHECK] Retrieved ${githubGuidelines.length} guidelines from GitHub for validation`);
        } catch (githubError) {
            console.warn(`[DUPLICATE_CHECK] Could not retrieve GitHub guidelines list: ${githubError.message}`);
            // Continue without GitHub validation if it fails
        }

        // Check each hash against the Firestore database
        const staleRecordsToCleanup = [];
        for (const hash of hashStrings) {
            try {
                const query = db.collection('guidelines').where('fileHash', '==', hash);
                const snapshot = await query.get();
                
                if (!snapshot.empty) {
                    // Found matching hash in Firestore, now validate if file still exists in GitHub
                    let isValidDuplicate = false;
                    
                    for (const doc of snapshot.docs) {
                        const data = doc.data();
                        const filename = data.filename || data.originalFilename || data.title;
                        
                        if (filename && githubGuidelines.length > 0) {
                            if (githubGuidelines.includes(filename)) {
                                // File exists in GitHub, this is a valid duplicate
                                isValidDuplicate = true;
                                console.log(`[DUPLICATE_CHECK] Valid duplicate found for hash: ${hash.substring(0, 16)}... (file: ${filename})`);
                                break;
                            } else {
                                // File doesn't exist in GitHub, mark for cleanup
                                staleRecordsToCleanup.push({
                                    id: doc.id,
                                    filename: filename,
                                    hash: hash
                                });
                                console.log(`[DUPLICATE_CHECK] Stale record found for hash: ${hash.substring(0, 16)}... (missing file: ${filename})`);
                            }
                        } else {
                            // No GitHub validation available or no filename, treat as duplicate for safety
                            isValidDuplicate = true;
                            console.log(`[DUPLICATE_CHECK] Duplicate found (no GitHub validation): ${hash.substring(0, 16)}...`);
                            break;
                        }
                    }
                    
                    if (isValidDuplicate) {
                        duplicates.push(hash);
                    }
                }
            } catch (queryError) {
                console.error(`[DUPLICATE_CHECK] Error querying hash ${hash.substring(0, 16)}...:`, queryError);
                // Continue with other hashes even if one fails
            }
        }

        // Clean up stale records if any were found
        if (staleRecordsToCleanup.length > 0) {
            console.log(`[DUPLICATE_CHECK] Cleaning up ${staleRecordsToCleanup.length} stale records`);
            try {
                const batch = db.batch();
                staleRecordsToCleanup.forEach(record => {
                    const docRef = db.collection('guidelines').doc(record.id);
                    batch.delete(docRef);
                });
                await batch.commit();
                console.log(`[DUPLICATE_CHECK] Successfully cleaned up ${staleRecordsToCleanup.length} stale records`);
            } catch (cleanupError) {
                console.error('[DUPLICATE_CHECK] Error cleaning up stale records:', cleanupError);
                // Don't fail the duplicate check if cleanup fails
            }
        }

        console.log(`[DUPLICATE_CHECK] Found ${duplicates.length} duplicates out of ${hashStrings.length} files`);
        
        res.json({
            success: true,
            duplicates: duplicates,
            message: `Duplicate check completed: ${duplicates.length} duplicates found`
        });

    } catch (error) {
        console.error('[DUPLICATE_CHECK] Error checking for duplicates:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during duplicate check' 
        });
    }
});

// Endpoint to handle guideline uploads
app.post('/uploadGuideline', authenticateUser, upload.single('file'), async (req, res) => {
    // Check if a file was uploaded
    if (!req.file) {
        console.error('No file uploaded');
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        // Check if the target folder exists in the GitHub repository
        const folderExists = await checkFolderExists(githubFolder);
        if (!folderExists) {
            return res.status(400).json({ message: 'Target folder does not exist in the repository' });
        }

        // Extract the uploaded file and its details
        const file = req.file;
        const fileName = file.originalname;
        const fileContent = file.buffer;

        // Calculate file hash for duplicate detection
        const fileHash = await calculateFileHash(fileContent);
        console.log(`[UPLOAD] Calculated hash for ${fileName}: ${fileHash.substring(0, 16)}...`);

        //console.log('Uploading file:', fileName);

        // Verify if the file already exists in the repository
        const filePath = `${githubFolder}/${encodeURIComponent(fileName)}`;
        let fileSha = await getFileSha(filePath);

        // Prepare the request body for the GitHub API
        const body = {
            message: `Add new guideline: ${fileName}`,
            content: fileContent.toString('base64'),
            branch: githubBranch
        };

        if (fileSha) {
            body.sha = fileSha;
        }

        // Construct the URL for uploading the file to GitHub
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;

        // Retry logic for handling conflicts
        const MAX_RETRIES = 3;
        let attempt = 0;
        let success = false;

        while (attempt < MAX_RETRIES && !success) {
            try {
                const response = await axios.put(url, body, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${githubToken}`
                    }
                });
                //console.log('GitHub API response:', response.data);
                success = true;
                
                // Store basic file record in Firestore for immediate duplicate detection
                try {
                    const cleanId = generateCleanDocId(fileName);
                    const basicGuidelineDoc = {
                        id: cleanId,
                        title: fileName.replace(/\.[^/.]+$/, ''), // Remove extension for title
                        filename: fileName,
                        originalFilename: fileName,
                        fileHash: fileHash,
                        downloadUrl: `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(fileName)}`,
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        processed: false, // Mark as not fully processed yet
                        content: null, // Will be filled by sync process
                        summary: null,
                        keywords: [],
                        condensed: null,
                        auditableElements: [] // Will be filled by sync process
                    };
                    
                    await db.collection('guidelines').doc(cleanId).set(basicGuidelineDoc);
                    console.log(`[UPLOAD] Stored basic record in Firestore for duplicate detection: ${cleanId}`);
                } catch (firestoreError) {
                    console.error('[UPLOAD] Error storing basic record in Firestore:', firestoreError);
                    // Don't fail the upload if Firestore storage fails
                }
                
                res.json({
                    success: true,
                    message: 'Guideline uploaded successfully',
                    data: response.data
                });
            } catch (error) {
                if (error.response?.status === 409) {
                    //console.log('Conflict detected, fetching latest SHA and retrying...');
                    fileSha = await getFileSha(filePath);
                    body.sha = fileSha;
                } else {
                    console.error('Error uploading guideline:', {
                        message: error.message,
                        stack: error.stack,
                        response: error.response?.data
                    });
                    res.status(500).json({
                        success: false,
                        message: error.message || 'Failed to upload guideline'
                    });
                    return;
                }
            }
            attempt++;
        }

        if (!success) {
            throw new Error('Failed to upload guideline after multiple attempts.');
        }
    } catch (error) {
        console.error('Error uploading guideline:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload guideline'
        });
    }
});

// Helper function to update the list of guidelines
async function updateGuidelinesMasterList(newFileName) {
    try {
        const listUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/guidance/list_of_guidelines.txt`;
        const listResponse = await axios.get(listUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });

        // Decode the current content
        const currentContent = Buffer.from(listResponse.data.content, 'base64').toString();
        
        // Add the new filename if it's not already in the list
        const guidelines = currentContent.split('\n').filter(line => line.trim());
        if (!guidelines.includes(newFileName)) {
            guidelines.push(newFileName);
            guidelines.sort(); // Sort alphabetically
            
            // Update the file
            const updatedContent = guidelines.join('\n');
            await axios.put(listUrl, {
                message: `Add ${newFileName} to guidelines list`,
                content: Buffer.from(updatedContent).toString('base64'),
                sha: listResponse.data.sha,
                branch: githubBranch
            }, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
        }
    } catch (error) {
        console.error('Error updating guidelines master list:', error);
        throw error;
    }
}

// Helper: normalise URL for deduplication
function normalizeUrl(inputUrl) {
    try {
        const url = new URL(inputUrl.trim());
        url.hash = '';
        // Lowercase host
        url.hostname = url.hostname.toLowerCase();
        // Remove common tracking params
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
        paramsToRemove.forEach(p => url.searchParams.delete(p));
        // Remove trailing slash for path (except root)
        if (url.pathname.endsWith('/') && url.pathname !== '/') {
            url.pathname = url.pathname.replace(/\/+$/, '');
        }
        return url.toString();
    } catch (e) {
        return inputUrl.trim();
    }
}

// Helper: read JSONL exclusions file from repo
async function readExclusionsFile() {
    const filePath = 'guidance/excluded_list.jsonl';
    try {
        const content = await getFileContents(filePath); // returns string or throws
        if (!content) return [];
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
        const entries = [];
        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                if (obj && obj.url) {
                    entries.push(obj);
                }
            } catch (_) {
                // ignore malformed lines
            }
        }
        return entries;
    } catch (err) {
        // If file doesn't exist yet, return empty list
        return [];
    }
}

// Helper: append one exclusion entry to JSONL file (dedupe on normalizedUrl)
async function appendExclusionEntry(entry) {
    const filePath = 'guidance/excluded_list.jsonl';
    const existing = await readExclusionsFile();
    const normalizedUrl = normalizeUrl(entry.url);
    const already = existing.some(e => normalizeUrl(e.url) === normalizedUrl);
    if (already) {
        return { skipped: true };
    }
    const newLine = JSON.stringify({
        url: entry.url,
        normalizedUrl: normalizedUrl,
        reason: entry.reason || 'excluded',
        title: entry.title || null,
        addedBy: entry.addedBy || 'system',
        addedAt: new Date().toISOString()
    });

    // Build new content (append with newline)
    const existingContent = existing.length > 0 ? existing.map(e => JSON.stringify(e)).join('\n') + '\n' : '';
    const updatedContent = existingContent + newLine + '\n';

    // Get SHA then PUT updated content
    const fileSha = await getFileSha(filePath);
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
    await axios.put(url, {
        message: 'Update excluded_list.jsonl',
        content: Buffer.from(updatedContent).toString('base64'),
        branch: githubBranch,
        ...(fileSha ? { sha: fileSha } : {})
    }, {
        headers: {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': `token ${githubToken}`
        }
    });
    return { skipped: false };
}

// Update the function that gets file contents
async function getFileContents(fileName) { // fileName is expected to be the full path from repo root e.g., guidance/condensed/file.pdf
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${fileName}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        
        // For PDF files, we can't directly extract text content via GitHub API
        // The GitHub API returns base64-encoded binary data for PDFs
        if (fileName.toLowerCase().endsWith('.pdf')) {
            console.warn(`[FETCH_CONTENT] Cannot extract text from PDF file: ${fileName}. PDFs need specialized text extraction.`);
            return null; // Return null to indicate that PDF text extraction is needed
        }
        
        // For text files, decode the base64 content
        if (response.data.content) {
            return Buffer.from(response.data.content, 'base64').toString();
        }
        
        console.warn(`[FETCH_CONTENT] No content found in response for: ${fileName}`);
        return null;
    } catch (error) {
        console.error('Error getting file contents:', error.response?.data || error.message);
        throw new Error('Failed to get file contents');
    }
}

// Update the function that gets list of guidelines
async function getGuidelinesList() {
    const listUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/guidance/list_of_guidelines.txt`;
    try {
        const response = await axios.get(listUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return Buffer.from(response.data.content, 'base64').toString();
    } catch (error) {
        console.error('Error getting guidelines list:', error.response?.data || error.message);
        throw new Error('Failed to get guidelines list');
    }
}

// Update the workflow trigger function
async function triggerGitHubWorkflow(workflowId, ref = githubBranch) {
    try {
        await axios.post(
            `https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows/${workflowId}/dispatches`,
            { ref },
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            }
        );
        //console.log(`Workflow ${workflowId} triggered successfully`);
    } catch (error) {
        console.error('Error triggering workflow:', error.response?.data || error.message);
        throw new Error('Failed to trigger workflow');
    }
}

// Update the repository dispatch function
async function createRepositoryDispatch(eventType, payload) {
    try {
        await axios.post(
            `https://api.github.com/repos/${githubOwner}/${githubRepo}/dispatches`,
            {
                event_type: eventType,
                client_payload: payload
            },
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            }
        );
        //console.log(`Repository dispatch event ${eventType} created successfully`);
    } catch (error) {
        console.error('Error creating repository dispatch:', error.response?.data || error.message);
        throw new Error('Failed to create repository dispatch');
    }
}

// Update the triggerWorkflow endpoint
app.post('/triggerWorkflow', authenticateUser, async (req, res) => {
    const { workflowId } = req.body;

    if (!workflowId) {
        return res.status(400).json({ 
            success: false, 
            message: 'Workflow ID is required' 
        });
    }

    try {
        await triggerGitHubWorkflow(workflowId);
        res.json({ 
            success: true, 
            message: `Workflow ${workflowId} triggered successfully` 
        });
    } catch (error) {
        console.error('Error in triggerWorkflow:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to trigger workflow',
            error: error.message
        });
    }
});

// Update the commitChanges endpoint
app.post('/commitChanges', authenticateUser, [
    body('fileName').trim().notEmpty(),
    body('content').trim().notEmpty(),
    body('commitMessage').trim().notEmpty()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    try {
        const { fileName, content, commitMessage } = req.body;
        const filePath = `algos/${fileName}`;
        //console.log('Processing commit for file:', filePath);

        // Get the current file's SHA (null if file doesn't exist)
        const fileSha = await getFileSha(filePath);
        //console.log('File SHA:', fileSha);

        // Update or create the file on GitHub
        const commitResult = await updateHtmlFileOnGitHub(filePath, content, fileSha);
        //console.log('Commit result:', commitResult);

        // Trigger the workflow to update guidance/list_of_guidelines.txt
        try {
            await createRepositoryDispatch('update_guidelines_list', { fileName });
            //console.log('Triggered workflow to update guidelines list');
        } catch (workflowError) {
            console.error('Error triggering workflow:', workflowError);
            // Don't fail the whole request if workflow trigger fails
        }

        res.json({
            success: true,
            message: 'Changes committed successfully',
            commit: commitResult
        });
    } catch (error) {
        console.error('Error in commitChanges:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to commit changes'
        });
    }
});
// New endpoint to handle the cross-check API call
app.post('/crossCheck', authenticateUser, async (req, res) => {
    const { clinicalNote, guidelines } = req.body;

    console.log('X-check request received with:', {
        clinicalNoteLength: clinicalNote?.length || 0,
        numberOfGuidelines: guidelines?.length || 0,
        guidelines: guidelines || []
    });

    if (!clinicalNote || !guidelines) {
        console.error('Missing clinicalNote or guidelines in request body');
        return res.status(400).json({ message: 'Clinical note and guidelines are required' });
    }

    try {
        // Load prompts configuration
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.crossCheck.prompt;
        
        // Fetch the content for each guideline
        console.log('Fetching content for guidelines...');
        const guidelinesWithContent = [];
        for (const guideline of guidelines) {
            try {
                // Convert guideline filename to the expected format
                const guidelineFilename = guideline.replace(/\.pdf$/i, '.html');
                console.log(`Processing guideline: ${guideline} -> ${guidelineFilename}`);
                
                // Fetch the content of the guideline
                console.log(`Fetching content for: ${guidelineFilename}`);
                const content = await fetchCondensedFile(guidelineFilename);
                console.log(`Fetched guideline content (${content.length} chars)`);
                
                // Add the guideline with its content to the array
                guidelinesWithContent.push(`${guideline}:\n${content}`);
                
                console.log(`Successfully fetched content for guideline: ${guideline}`);
            } catch (error) {
                console.error(`Failed to fetch content for guideline: ${guideline}`, error);
                // Add the guideline without content if we couldn't fetch it
                guidelinesWithContent.push(`${guideline}: [Content unavailable]`);
            }
        }
        
        // Replace placeholders in the prompt
        console.log('Preparing prompt with guideline content...');
        const filledPrompt = systemPrompt
            .replace('{{text}}', clinicalNote)
            .replace('{{guidelines}}', guidelinesWithContent.join('\n\n'));

        console.log(`Prompt prepared (${filledPrompt.length} chars) - sending to AI...`);
        const response = await routeToAI(filledPrompt, req.user.uid);
        console.log('AI response received:', {
            responseType: typeof response,
            responseLength: typeof response === 'string' ? response.length : 
                           (typeof response === 'object' && response.content ? response.content.length : 'unknown')
        });

        // Log the interaction
        try {
            await logAIInteraction({
                clinicalNote,
                guidelines: guidelinesWithContent,
                prompt: filledPrompt
            }, {
                success: true,
                response
            }, 'crossCheck');
        } catch (logError) {
            console.error('Error logging interaction:', logError);
        }

        // Extract content if necessary
        const responseContent = typeof response === 'object' && response.content ? response.content : response;
        
        // Log the number of <i> tags in the response
        let italicTagCount = 0;
        let italicMatches = [];
        if (typeof responseContent === 'string') {
            const italicRegex = /<i>(.*?)<\/i>/g;
            let match;
            while ((match = italicRegex.exec(responseContent)) !== null) {
                italicTagCount++;
                italicMatches.push(match[1].substring(0, 30) + '...'); // Log first 30 chars of each match
            }
        }
        console.log(`Response contains ${italicTagCount} italicized changes:`, italicMatches);
        
        res.json({ updatedNote: responseContent });
    } catch (error) {
        console.error('Error in /crossCheck:', error);

        // Log the error
        try {
            await logAIInteraction({
                clinicalNote,
                guidelines,
                prompt: prompts.crossCheck.prompt
            }, {
                success: false,
                error: error.message
            }, 'crossCheck');
        } catch (logError) {
            console.error('Error logging failure:', logError);
        }

        res.status(500).json({ message: 'Failed to process cross-check' });
    }
});

// Update the /updatePrompts endpoint to handle FormData
app.post('/updatePrompts', authenticateUser, upload.none(), async (req, res) => {
    // Add CORS headers
    res.header('Access-Control-Allow-Origin', req.headers.origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

    //console.log('Received request to update prompts');
    //console.log('Request body:', req.body);

    const updatedPrompts = req.body.updatedPrompts;

    if (!updatedPrompts) {
        console.error('No updated prompts provided');
        return res.status(400).json({ message: 'Updated prompts are required' });
    }

    try {
        // Convert updated prompts to JSON string
        const newPromptsContent = JSON.stringify(JSON.parse(updatedPrompts), null, 2);
        //console.log('New prompts content:', newPromptsContent);

        // Get the current file's SHA (null if file doesn't exist)
        const fileSha = await getFileSha('prompts.json');
        ///console.log('Current file SHA:', fileSha);

        // Update prompts.json on GitHub
        const commitResult = await updateHtmlFileOnGitHub('prompts.json', newPromptsContent, fileSha);
        //console.log('GitHub commit result:', commitResult);

        res.json({
            success: true,
            message: 'Prompts updated successfully',
            commit: commitResult
        });
    } catch (error) {
        console.error('Error updating prompts.json:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update prompts'
        });
    }
});

// Update the /updateAIPreference endpoint to handle both GET and POST requests
app.all('/updateAIPreference', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email || 'unknown';
    
    // If this is a GET request, return the current AI preference
    if (req.method === 'GET') {
      try {
        const provider = await getUserAIPreference(userId);
        return res.json({ success: true, provider });
      } catch (error) {
        console.error('Error getting AI preference:', error);
        // If Firestore fails, fall back to environment variable
        const fallbackProvider = process.env.PREFERRED_AI_PROVIDER || 'DeepSeek';
        return res.json({ 
          success: true, 
          provider: fallbackProvider,
          note: 'Using default provider due to error'
        });
      }
    }
    
    // Handle POST request to update the AI preference
    if (req.method === 'POST') {
      console.log('=== AI Provider Update Request ===');
      console.log('Request received from user:', userEmail);
      console.log('User ID:', userId);
      
      const { provider } = req.body;
      
      if (!provider) {
        return res.status(400).json({ success: false, message: 'Provider is required' });
      }
      
      console.log('Requested provider:', provider);
      
      if (provider !== 'OpenAI' && provider !== 'DeepSeek' && provider !== 'Anthropic' && provider !== 'Mistral' && provider !== 'Gemini') {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid provider. Must be either "OpenAI", "DeepSeek", "Anthropic", "Mistral", or "Gemini"'
        });
      }
      
      // Verify we have the required API keys
      if (provider === 'OpenAI' && !process.env.OPENAI_API_KEY) {
        return res.status(500).json({ 
          success: false, 
          message: 'OpenAI API key is not configured' 
        });
      }
      
      if (provider === 'DeepSeek' && !process.env.DEEPSEEK_API_KEY) {
        return res.status(500).json({ 
          success: false, 
          message: 'DeepSeek API key is not configured' 
        });
      }
      
      if (provider === 'Anthropic' && !process.env.ANTHROPIC_API_KEY) {
        return res.status(500).json({ 
          success: false, 
          message: 'Anthropic API key is not configured' 
        });
      }
      
      if (provider === 'Mistral' && !process.env.MISTRAL_API_KEY) {
        return res.status(500).json({ 
          success: false, 
          message: 'Mistral API key is not configured' 
        });
      }
      
      if (provider === 'Gemini' && !process.env.GOOGLE_AI_API_KEY) {
        return res.status(500).json({ 
          success: false, 
          message: 'Gemini API key is not configured' 
        });
      }
      
      try {
        // Try to update user preference in Firestore
        const firestoreUpdated = await updateUserAIPreference(userId, provider);
        
        // Always update environment variable as a fallback
        process.env.PREFERRED_AI_PROVIDER = provider;
        
        // Log the AI interaction
        await logAIInteraction(
          {
            action: 'update_ai_provider',
            previousProvider: await getUserAIPreference(userId),
            newProvider: provider,
            userEmail,
            userId
          },
          { success: true },
          'updateAIPreference'
        );
        
        // If Firestore wasn't updated, include a warning in the response
        if (firestoreUpdated === false) {
          return res.status(202).json({
            success: true,
            provider,
            warning: 'Preference updated temporarily but may not persist across sessions',
            details: 'Database operation skipped, but preference is set for current session'
          });
        }
        
        return res.json({ success: true, provider });
      } catch (error) {
        console.error('Error updating AI preference:', error);
        
        // Log the failure
        await logAIInteraction(
          {
            action: 'update_ai_provider',
            previousProvider: 'DeepSeek',
            newProvider: provider,
            userEmail,
            userId
          },
          { success: false, error: error.message },
          'updateAIPreference'
        );
        
        // Still update the environment variable as a fallback
        process.env.PREFERRED_AI_PROVIDER = provider;
        
        // Return a 202 Accepted with a warning message
        return res.status(202).json({ 
          success: true, 
          provider,
          warning: 'Preference updated temporarily but may not persist across sessions',
          details: 'Database operation failed, but preference is set for current session'
        });
      }
    }
    
    // If we get here, it's not a GET or POST request
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  } catch (error) {
    console.error('Unexpected error in updateAIPreference endpoint:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Add new endpoint to get prompts data
app.get('/getPrompts', (req, res) => {
  try {
    // Check if prompts.json exists
    const promptsPath = path.join(__dirname, 'prompts.json');
    let prompts;
    
    if (fs.existsSync(promptsPath)) {
      try {
        prompts = require('./prompts.json');
      } catch (readError) {
        console.error('Error reading prompts.json, creating default:', readError);
        // Create default prompts if file exists but can't be read
        prompts = createDefaultPrompts();
        // Save default prompts
        try {
          fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
          console.log('Created default prompts.json');
        } catch (writeError) {
          console.error('Failed to write default prompts.json:', writeError);
        }
      }
    } else {
      // Create default prompts if file doesn't exist
      console.log('prompts.json not found, creating default');
      prompts = createDefaultPrompts();
      // Save default prompts
      try {
        fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2));
        console.log('Created default prompts.json');
      } catch (writeError) {
        console.error('Failed to write default prompts.json:', writeError);
      }
    }
    
    res.json({ success: true, prompts });
  } catch (error) {
    console.error('Error loading prompts:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to load prompts configuration',
      error: error.message
    });
  }
});

// Function to create default prompts
function createDefaultPrompts() {
  return {
    guidelineApplicator: {
      system_prompt: "You are a medical AI assistant helping apply clinical guidelines to specific patient cases."
    },
    clinicalNote: {
      prompt: "You are a medical AI assistant helping create clinical notes based on guidelines."
    },
    issues: {
      system_prompt: "You are a medical AI assistant helping identify clinical issues from patient information."
    },
    testTranscript: {
      title: "Medical SBAR Transcript Generation",
      description: "Used to generate medical-grade clinical clerkings with heavy medical jargon and abbreviations",
      prompt: "Create a medical clerking using SBAR format (Situation, Background, Assessment, Recommendation) for the following clinical scenario. Use medical terminology and commonly used British abbreviations as would be used in real hospital documentation.\n\nRequirements:\n- Use proper medical abbreviations (e.g., G2P1, BP, HR, CTG, USS, FBC, etc.)\n- Include relevant clinical observations and measurements\n- Follow realistic hospital workflow and terminology\n- Make it clinically authentic with realistic patient demographics\n- Use appropriate specialty-specific language (obstetric/gynecological terminology)\n- Include key investigations and management plans\n- This is for educational/testing purposes only - entirely fictional\n\nFormat as:\nSITUATION: [Demographics, presentation, key clinical issue]\nBACKGROUND: [Relevant history, previous episodes, risk factors, medications]\nASSESSMENT: [Clinical findings, vital signs, test results, differential diagnosis]\nRECOMMENDATION: [Management plan, monitoring, follow-up, further investigations]\n\nClinical scenario: "
    }
  };
}

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : err.message
  });
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Update the firebase-config endpoint
app.get('/firebase-config', (req, res) => {
    // Only send the necessary Firebase config
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

// Add test endpoint for AI interaction logging
app.get('/test-logging', async (req, res) => {
    try {
        console.log('Test logging endpoint called');
        const testPrompt = "This is a test prompt";
        const testResponse = {
            content: "This is a test response",
            ai_provider: "DeepSeek",
            ai_model: "deepseek-chat"
        };
        
        const result = await logAIInteraction(testPrompt, testResponse, 'test-logging');
        
        if (result) {
            res.status(200).json({ 
                success: true, 
                message: 'Test log saved successfully',
                checkLocations: [
                    'GitHub repository: logs/ai-interactions/',
                    'Local directory: ./logs/local-ai-interactions/',
                    'Emergency logs: ./logs/emergency-logs/'
                ]
            });
        } else {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to save test log, check server logs for details' 
            });
        }
    } catch (error) {
        console.error('Error in test-logging endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error testing logging',
            error: error.message
        });
    }
});

// Add endpoint to delete all logs
app.post('/delete-all-logs', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !req.user.admin) {
            // Additional check for specific user IDs that are allowed
            const allowedUsers = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];
            if (!allowedUsers.includes(req.user.uid)) {
                console.log('Unauthorized deletion attempt by:', req.user.uid);
                return res.status(403).json({ 
                    success: false, 
                    message: 'Only admin users can delete all logs' 
                });
            }
        }
        
        console.log(`User ${req.user.uid} requested to delete all logs`);
        
        // Get all files in the logs/ai-interactions directory
        const response = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/logs/ai-interactions`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        
        if (!response.data || !Array.isArray(response.data)) {
            throw new Error('Invalid response from GitHub API');
        }
        
        const files = response.data;
        console.log(`Found ${files.length} files in ai-interactions folder`);
        
        if (files.length === 0) {
            return res.json({ 
                success: true, 
                message: 'No log files found to delete' 
            });
        }
        
        // Delete each file
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };
        
        for (const file of files) {
            try {
                console.log(`Deleting file: ${file.path}`);
                
                const deleteResponse = await axios.delete(
                    `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${file.path}`,
                    {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'Authorization': `token ${githubToken}`
                        },
                        data: {
                            message: `Delete log file ${file.name}`,
                            sha: file.sha,
                            branch: githubBranch
                        }
                    }
                );
                
                results.success++;
                console.log(`Successfully deleted ${file.path}`);
            } catch (error) {
                results.failed++;
                const errorInfo = {
                    file: file.path,
                    status: error.response?.status,
                    message: error.response?.data?.message || error.message
                };
                results.errors.push(errorInfo);
                console.error(`Failed to delete ${file.path}:`, errorInfo);
            }
        }
        
        // Return results
        res.json({ 
            success: true, 
            message: `Deleted ${results.success} log files, failed to delete ${results.failed} files`,
            details: results
        });
    } catch (error) {
        console.error('Error deleting all logs:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting log files',
            error: error.message,
            details: error.response?.data
        });
    }
});

// Add endpoint to archive old logs when count exceeds 100
app.post('/admin/archive-logs-if-needed', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !req.user.admin) {
            const allowedUsers = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];
            if (!allowedUsers.includes(req.user.uid)) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Only admin users can archive logs' 
                });
            }
        }
        
        console.log(`Checking if log archiving is needed...`);
        
        // Get all files in the logs/ai-interactions directory
        const response = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/logs/ai-interactions`, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        
        if (!response.data || !Array.isArray(response.data)) {
            throw new Error('Invalid response from GitHub API');
        }
        
        const allFiles = response.data;
        console.log(`Found ${allFiles.length} total files in ai-interactions folder`);
        
        // Group files by timestamp (keep .txt and .json pairs together)
        const fileGroups = new Map();
        
        for (const file of allFiles) {
            const timestampMatch = file.name.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/);
            if (timestampMatch) {
                const timestamp = timestampMatch[1];
                if (!fileGroups.has(timestamp)) {
                    fileGroups.set(timestamp, []);
                }
                fileGroups.get(timestamp).push(file);
            }
        }
        
        const totalGroups = fileGroups.size;
        console.log(`Found ${totalGroups} file groups (timestamp pairs)`);
        
        // OPTIMISATION: Increase threshold to 500 groups to reduce archiving frequency
        if (totalGroups <= 500) {
            return res.json({
                success: true,
                message: `No archiving needed. Found ${totalGroups} file groups (≤500)`,
                totalGroups: totalGroups,
                archived: 0
            });
        }
        
        // OPTIMISATION: Keep more recent files, archive in smaller batches
        const sortedTimestamps = Array.from(fileGroups.keys()).sort().reverse();
        const timestampsToKeep = sortedTimestamps.slice(0, 400); // Keep 400 most recent
        const timestampsToArchive = sortedTimestamps.slice(400, 500); // Archive only 100 at a time
        
        console.log(`Will keep ${timestampsToKeep.length} most recent groups, archive ${timestampsToArchive.length} older groups`);
        
        if (timestampsToArchive.length === 0) {
            return res.json({
                success: true,
                message: 'No files to archive',
                totalGroups: totalGroups,
                archived: 0
            });
        }
        
        // Create archived directory if it doesn't exist
        let archivedDirExists = false;
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/logs/ai-interactions-archived`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            archivedDirExists = true;
        } catch (error) {
            if (error.response?.status === 404) {
                console.log('Archive directory does not exist, will create it');
            } else {
                throw error;
            }
        }
        
        // OPTIMISATION: Use simple file deletion instead of complex tree archiving
        console.log('Using simple file deletion to avoid 502 errors...');
        
        // Collect files to delete (old ones)
        const filesToDelete = [];
        
        for (const timestamp of timestampsToArchive) {
            filesToDelete.push(...fileGroups.get(timestamp));
        }
        
        console.log(`Will delete ${filesToDelete.length} old files to prevent GitHub API overload`);
        
        // Delete files one by one (much more reliable than tree operations)
        const deleteResults = {
            deleted: 0,
            failed: 0,
            errors: []
        };
        
        // Process in smaller batches to avoid rate limiting
        const BATCH_SIZE = 10;
        for (let i = 0; i < filesToDelete.length; i += BATCH_SIZE) {
            const batch = filesToDelete.slice(i, i + BATCH_SIZE);
            
            console.log(`Deleting batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(filesToDelete.length/BATCH_SIZE)} (${batch.length} files)`);
            
            const deletePromises = batch.map(async (file) => {
                try {
                    await axios.delete(
                        `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${file.path}`,
                        {
                            headers: {
                                'Accept': 'application/vnd.github.v3+json',
                                'Authorization': `token ${githubToken}`
                            },
                            data: {
                                message: `Delete old log file ${file.name}`,
                                sha: file.sha,
                                branch: githubBranch
                            }
                        }
                    );
                    deleteResults.deleted++;
                    console.log(`Deleted: ${file.name}`);
                } catch (error) {
                    deleteResults.failed++;
                    const errorInfo = {
                        file: file.name,
                        status: error.response?.status,
                        message: error.response?.data?.message || error.message
                    };
                    deleteResults.errors.push(errorInfo);
                    console.error(`Failed to delete ${file.name}:`, errorInfo);
                }
            });
            
            // Wait for batch to complete
            await Promise.all(deletePromises);
            
            // Small delay between batches to be gentle on GitHub API
            if (i + BATCH_SIZE < filesToDelete.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        const archiveResults = {
            moved: 0, // We're deleting, not moving
            deleted: deleteResults.deleted,
            failed: deleteResults.failed,
            errors: deleteResults.errors,
            method: 'simple-deletion'
        };
        
        res.json({
            success: true,
            message: `Deleted ${archiveResults.deleted} old files (${timestampsToArchive.length} groups), ${archiveResults.failed} failed`,
            totalGroups: totalGroups,
            deletedGroups: timestampsToArchive.length,
            deletedFiles: archiveResults.deleted,
            failedFiles: archiveResults.failed,
            method: archiveResults.method,
            details: archiveResults
        });
        
    } catch (error) {
        console.error('Error archiving logs:', error);
        res.status(500).json({
            success: false,
            message: 'Error archiving log files',
            error: error.message,
            details: error.response?.data
        });
    }
});
// Add endpoint to clean existing human-friendly names in the database
app.post('/admin/clean-guideline-titles', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        if (!req.user || !req.user.admin) {
            const allowedUsers = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];
            if (!allowedUsers.includes(req.user.uid)) {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Only admin users can clean guideline titles' 
                });
            }
        }
        
        console.log(`User ${req.user.uid} requested to clean guideline titles`);
        
        // Get all guidelines
        const guidelinesSnapshot = await db.collection('guidelines').get();
        console.log(`Found ${guidelinesSnapshot.size} guidelines to process`);
        
        const results = {
            total: guidelinesSnapshot.size,
            cleaned: 0,
            unchanged: 0,
            errors: []
        };
        
        const batch = db.batch();
        let hasChanges = false;
        
        for (const doc of guidelinesSnapshot.docs) {
            try {
                const data = doc.data();
                const originalTitle = data.title;
                const originalHumanFriendlyName = data.humanFriendlyName;
                
                let needsUpdate = false;
                const updates = {};
                
                // Clean the title if it exists and needs cleaning
                if (originalTitle && typeof originalTitle === 'string') {
                    const cleanedTitle = cleanHumanFriendlyName(originalTitle);
                    if (cleanedTitle !== originalTitle) {
                        updates.title = cleanedTitle;
                        needsUpdate = true;
                        console.log(`Cleaning title for ${doc.id}: "${originalTitle}" -> "${cleanedTitle}"`);
                    }
                }
                
                // Clean the humanFriendlyName if it exists and needs cleaning
                if (originalHumanFriendlyName && typeof originalHumanFriendlyName === 'string') {
                    const cleanedHumanFriendlyName = cleanHumanFriendlyName(originalHumanFriendlyName);
                    if (cleanedHumanFriendlyName !== originalHumanFriendlyName) {
                        updates.humanFriendlyName = cleanedHumanFriendlyName;
                        needsUpdate = true;
                        console.log(`Cleaning humanFriendlyName for ${doc.id}: "${originalHumanFriendlyName}" -> "${cleanedHumanFriendlyName}"`);
                    }
                }
                
                if (needsUpdate) {
                    batch.update(doc.ref, updates);
                    hasChanges = true;
                    results.cleaned++;
                } else {
                    results.unchanged++;
                }
                
            } catch (error) {
                console.error(`Error processing guideline ${doc.id}:`, error);
                results.errors.push({
                    id: doc.id,
                    error: error.message
                });
            }
        }
        
        // Commit the batch if there are changes
        if (hasChanges) {
            console.log(`Committing ${results.cleaned} title updates`);
            await batch.commit();
        }
        
        res.json({
            success: true,
            message: `Cleaned ${results.cleaned} titles, ${results.unchanged} unchanged`,
            results
        });
        
    } catch (error) {
        console.error('Error cleaning guideline titles:', error);
        res.status(500).json({
            success: false,
            message: 'Error cleaning guideline titles',
            error: error.message
        });
    }
});

// Add the cleanHumanFriendlyName function that was removed earlier
function cleanHumanFriendlyName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return rawName;
  }
  
  let cleaned = rawName.trim();
  
  // Remove common AI response prefixes
  cleaned = cleaned.replace(/^(The\s+)?(human-friendly\s+name\s+or\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');
  cleaned = cleaned.replace(/^(Human-friendly\s+name\s+or\s+short\s+title\s+of\s+the\s+guideline\s*[:"]*\s*)/i, '');
  cleaned = cleaned.replace(/^(Title\s*[:]*\s*)/i, '');
  cleaned = cleaned.replace(/^(The\s+short\s+title\s+of\s+this\s+guideline\s+is\s*[:"]*\s*)/i, '');
  
  // Remove internal reference codes at the beginning (MP053, CG12004, etc.)
  cleaned = cleaned.replace(/^(MP|CG|SP|MD|GP|GAU)\d+\s*[-:]?\s*/i, '');
  
  // Remove common prefixes that don't add value
  cleaned = cleaned.replace(/^(Guideline|Protocol|Policy|Standard|Procedure)\s*[-:]?\s*/i, '');
  
  // Remove relevance scores and parenthetical information at the end
  cleaned = cleaned.replace(/\s*\([^)]*relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\([^)]*score[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(high\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(medium\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(low\s+relevance[^)]*\)$/i, '');
  cleaned = cleaned.replace(/\s*\(not\s+relevant[^)]*\)$/i, '');
  
  // Remove standalone numeric scores in parentheses at the end
  cleaned = cleaned.replace(/\s*\(\d*\.?\d+\)$/g, '');
  
  // Remove version information in parentheses
  cleaned = cleaned.replace(/\s*\(v?\d+(\.\d+)?\)\s*$/i, '');
  cleaned = cleaned.replace(/\s*\(version\s*\d+(\.\d+)?\)\s*$/i, '');
  
  // Remove file extensions
  cleaned = cleaned.replace(/\.(pdf|doc|docx|txt)$/i, '');
  
  // Remove quotes at the beginning and end
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  
  // Remove trailing periods that aren't part of abbreviations
  cleaned = cleaned.replace(/\.$/, '');
  
  // Common abbreviation expansions for better readability
  const abbreviationMappings = {
    'APH': 'Antepartum Haemorrhage',
    'PPH': 'Postpartum Haemorrhage',
    'BSOTS': 'Blood Saving in Obstetric Theatres',
    'BAC': 'Birth After Caesarean',
    'LSCS': 'Lower Segment Caesarean Section',
    'CTG': 'Cardiotocography',
    'FHR': 'Fetal Heart Rate',
    'PCOS': 'Polycystic Ovary Syndrome',
    'IVF': 'In Vitro Fertilisation',
    'ICSI': 'Intracytoplasmic Sperm Injection'
  };
  
  // Apply abbreviation expansions for standalone abbreviations at the start
  Object.entries(abbreviationMappings).forEach(([abbrev, expansion]) => {
    const regex = new RegExp(`^${abbrev}\\b`, 'i');
    if (regex.test(cleaned)) {
      cleaned = cleaned.replace(regex, expansion);
    }
  });
  
  // Clean up multiple spaces and normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Capitalize first letter if it's not already
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  
  return cleaned;
}

// Endpoint to get guidelines that need content processing
app.post('/getGuidelinesNeedingContent', authenticateUser, async (req, res) => {
    try {
        console.log(`[DEBUG] Getting guidelines needing content for user: ${req.user.uid}`);
        
        // Get all guidelines from Firestore
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const allGuidelines = [];
        
        guidelinesSnapshot.forEach(doc => {
            const data = doc.data();
            allGuidelines.push({
                id: doc.id,
                ...data
            });
        });
        
        console.log(`[DEBUG] Found ${allGuidelines.length} total guidelines in Firestore`);
        
        // Filter guidelines that need content processing
        const guidelinesNeedingContent = allGuidelines.filter(guideline => {
            const hasContent = guideline.content && guideline.content !== null && guideline.content.trim().length > 0;
            const hasCondensed = guideline.condensed && guideline.condensed !== null && guideline.condensed.trim().length > 0;
            
            // Return true if either content or condensed is missing
            return !hasContent || !hasCondensed;
        });
        
        console.log(`[DEBUG] Found ${guidelinesNeedingContent.length} guidelines needing content processing`);
        
        // Return only the necessary fields for processing
        const processableGuidelines = guidelinesNeedingContent.map(guideline => ({
            id: guideline.id,
            title: guideline.title || guideline.humanFriendlyName || 'Unknown',
            filename: guideline.filename,
            originalFilename: guideline.originalFilename,
            hasContent: !!(guideline.content && guideline.content.trim().length > 0),
            hasCondensed: !!(guideline.condensed && guideline.condensed.trim().length > 0)
        }));
        
        res.json({
            success: true,
            guidelines: processableGuidelines,
            total: processableGuidelines.length
        });
        
    } catch (error) {
        console.error('[ERROR] Failed to get guidelines needing content:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint to process content for a single guideline
app.post('/processGuidelineContent', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.body;
        const userId = req.user.uid;
        
        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'Missing guidelineId parameter'
            });
        }
        
        // console.log(`[DEBUG] Processing content for guideline: ${guidelineId}`);
        
        // Get guideline data from Firestore
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guidelineData = guidelineDoc.data();
        
        // Use the existing checkAndGenerateContent function
        const result = await checkAndGenerateContent(guidelineData, guidelineId);
        
        if (result.updated && Object.keys(result.updates).length > 0) {
            // Update the document in Firestore
            await db.collection('guidelines').doc(guidelineId).update(result.updates);
            
            console.log(`[DEBUG] Successfully updated content for guideline: ${guidelineId}`);
            
            res.json({
                success: true,
                updated: true,
                message: `Content processed and updated for ${guidelineData.title || guidelineId}`,
                updatedFields: Object.keys(result.updates)
            });
        } else {
            // console.log(`[DEBUG] No content updates needed for guideline: ${guidelineId}`);
            
            res.json({
                success: true,
                updated: false,
                message: `No content processing needed for ${guidelineData.title || guidelineId}`
            });
        }
        
    } catch (error) {
        console.error(`[ERROR] Failed to process content for guideline:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Generic endpoint to ensure metadata completion for specified fields
app.post('/ensureMetadataCompletion', authenticateUser, async (req, res) => {
    try {
        const { singleGuideline, targetFields } = req.body;
        
        // Define the default priority order for metadata fields
        const defaultFieldOrder = [
            'humanFriendlyName',
            'organisation', 
            'yearProduced',
            'title',
            'summary',
            'keywords'
        ];
        
        // Use specified fields or default priority order
        const fieldsToProcess = targetFields || defaultFieldOrder;
        
        if (singleGuideline) {
            // Process single guideline
            console.log(`[METADATA_COMPLETION] Processing single guideline: ${singleGuideline} for fields: ${fieldsToProcess.join(', ')}`);
            
            const doc = await db.collection('guidelines').doc(singleGuideline).get();
            if (!doc.exists) {
                return res.status(404).json({
                    success: false,
                    error: `Guideline ${singleGuideline} not found`
                });
            }
            
            const result = await processGuidelineMetadataFields(doc, fieldsToProcess, req.user.uid);
            return res.json({
                success: true,
                message: `Processed single guideline: ${singleGuideline}`,
                ...result
            });
        }
        
        console.log(`[METADATA_COMPLETION] Starting completion check for fields: ${fieldsToProcess.join(', ')}...`);
        
        // Get all guidelines
        const snapshot = await db.collection('guidelines').get();
        const results = {
            total: snapshot.size,
            processed: 0,
            fieldResults: [],
            errors: []
        };
        
        // Process each field sequentially
        for (const fieldName of fieldsToProcess) {
            console.log(`[METADATA_COMPLETION] Processing field: ${fieldName}`);
            
            const fieldResult = await processMetadataFieldForAllGuidelines(snapshot, fieldName, req.user.uid);
            results.fieldResults.push(fieldResult);
            results.processed += fieldResult.updated;
            
            console.log(`[METADATA_COMPLETION] ${fieldName}: ${fieldResult.completionRate}% complete (${fieldResult.completed}/${fieldResult.total})`);
        }
        
        // Calculate overall completion rate
        const totalFields = fieldsToProcess.length * snapshot.size;
        const completedFields = results.fieldResults.reduce((sum, field) => sum + field.completed, 0);
        const overallCompletionRate = totalFields > 0 ? Math.round((completedFields / totalFields) * 100) : 0;
        
        results.overallCompletionRate = overallCompletionRate;
        results.fieldsCompleted = completedFields;
        
        console.log(`[METADATA_COMPLETION] Overall completion results:`, {
            total: results.total,
            processed: results.processed,
            fieldsCompleted: results.fieldsCompleted,
            overallCompletionRate: `${overallCompletionRate}%`
        });
        
        res.json({
            success: true,
            message: `Metadata completion process finished. ${overallCompletionRate}% overall completion rate.`,
            ...results
        });
        
    } catch (error) {
        console.error('[METADATA_COMPLETION] Error in completion process:', error);
        res.status(500).json({
            success: false,
            error: `Failed to ensure metadata completion: ${error.message}`
        });
    }
});

// Generic function to process a single metadata field for all guidelines
async function processMetadataFieldForAllGuidelines(snapshot, fieldName, userId) {
    const fieldResult = {
        field: fieldName,
        total: snapshot.size,
        completed: 0,
        updated: 0,
        errors: []
    };
    
    console.log(`[METADATA_FIELD] Processing ${fieldName} for ${snapshot.size} guidelines...`);
    
    for (const doc of snapshot.docs) {
        try {
            const result = await processMetadataFieldForGuideline(doc, fieldName, userId);
            
            if (result.status === 'already_complete' || result.status === 'updated') {
                fieldResult.completed++;
            }
            
            if (result.status === 'updated') {
                fieldResult.updated++;
            }
            
            if (result.status === 'error') {
                fieldResult.errors.push({
                    guidelineId: doc.id,
                    error: result.error
                });
            }
        } catch (error) {
            fieldResult.errors.push({
                guidelineId: doc.id,
                error: error.message
            });
        }
    }
    
    fieldResult.completionRate = Math.round((fieldResult.completed / fieldResult.total) * 100);
    
    return fieldResult;
}

// Generic function to process multiple metadata fields for a single guideline
async function processGuidelineMetadataFields(doc, fieldsToProcess, userId) {
    const guidelineId = doc.id;
    const results = {
        guidelineId,
        fieldResults: [],
        totalUpdated: 0
    };
    
    for (const fieldName of fieldsToProcess) {
        try {
            const fieldResult = await processMetadataFieldForGuideline(doc, fieldName, userId);
            results.fieldResults.push({
                field: fieldName,
                ...fieldResult
            });
            
            if (fieldResult.status === 'updated') {
                results.totalUpdated++;
            }
        } catch (error) {
            results.fieldResults.push({
                field: fieldName,
                status: 'error',
                error: error.message
            });
        }
    }
    
    return results;
}

// Generic function to process a single metadata field for a single guideline
async function processMetadataFieldForGuideline(doc, fieldName, userId) {
    const guidelineId = doc.id;
    const currentData = doc.data();
    
    try {
        // Check if field is already complete
        const hasValidField = isFieldComplete(currentData[fieldName]);
        
        if (hasValidField) {
            return {
                status: 'already_complete',
                value: currentData[fieldName]
            };
        }
        
        console.log(`[METADATA_FIELD] Processing ${fieldName} for: ${guidelineId}`);
        
        // Get field value using strategy pattern
        let newValue = await generateFieldValue(fieldName, currentData, userId);
        
        // Update the guideline with the new field value
        if (newValue && newValue.length > 0) {
            await doc.ref.update({ [fieldName]: newValue });
            console.log(`[METADATA_FIELD] ✓ Updated ${guidelineId}.${fieldName}: "${newValue}"`);
            
            return {
                status: 'updated',
                oldValue: currentData[fieldName] || null,
                newValue: newValue
            };
        } else {
            console.log(`[METADATA_FIELD] ✗ Failed to generate valid ${fieldName} for ${guidelineId}`);
            return {
                status: 'error',
                error: `Could not generate valid ${fieldName}`
            };
        }
        
    } catch (error) {
        console.error(`[METADATA_FIELD] Error processing ${fieldName} for ${guidelineId}:`, error);
        return {
            status: 'error',
            error: error.message
        };
    }
}

// Helper function to check if a field value is complete
function isFieldComplete(value) {
    if (!value) return false;
    if (typeof value !== 'string') return true; // Non-string values are considered complete
    
    const invalidValues = ['N/A', 'Not available', 'Unknown', '', 'null', 'undefined'];
    const lowerValue = value.toLowerCase().trim();
    
    return !invalidValues.includes(lowerValue) && value.length > 2;
}

// Helper function to generate field value using different strategies
async function generateFieldValue(fieldName, currentData, userId) {
    switch (fieldName) {
        case 'humanFriendlyName':
            return await generateHumanFriendlyName(currentData, userId);
            
        case 'organisation':
            return await generateOrganisation(currentData, userId);
            
        case 'yearProduced':
            return await generateYearProduced(currentData, userId);
            
        case 'title':
            return await generateTitle(currentData, userId);
            
        case 'summary':
            return await generateSummary(currentData, userId);
            
        case 'keywords':
            return await generateKeywords(currentData, userId);
            
        default:
            console.log(`[METADATA_FIELD] Unknown field type: ${fieldName}`);
            return null;
    }
}

// Field-specific generation functions
async function generateHumanFriendlyName(currentData, userId) {
    // Strategy 1: Use title if available and clean it
    if (currentData.title && currentData.title.length > 2) {
        return cleanHumanFriendlyName(currentData.title);
    }
    
    // Strategy 2: Use filename if title is not good enough
    if (currentData.filename) {
        return cleanHumanFriendlyName(currentData.filename.replace(/\.pdf$/i, ''));
    } else if (currentData.originalFilename) {
        return cleanHumanFriendlyName(currentData.originalFilename.replace(/\.pdf$/i, ''));
    }
    
    // Strategy 3: Fallback to document ID
    const docId = currentData.id || 'Unknown';
    let friendlyName = docId.replace(/[-_]/g, ' ').replace(/\.pdf$/i, '');
    return friendlyName.split(' ').map(word => 
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

async function generateOrganisation(currentData, userId) {
    // Try to extract from existing data first
    if (currentData.title) {
        const title = currentData.title.toLowerCase();
        if (title.includes('nice')) return 'NICE';
        if (title.includes('rcog') || title.includes('gtg')) return 'RCOG';
        if (title.includes('bjog')) return 'BJOG';
        if (title.includes('bashh')) return 'BASHH';
    }
    
    // Try AI extraction from content
    return await extractUsingAI('extractOrganisation', currentData, userId);
}

async function generateYearProduced(currentData, userId) {
    // Try to extract year from title or filename
    const textToSearch = [currentData.title, currentData.filename, currentData.originalFilename]
        .filter(Boolean)
        .join(' ');
    
    const yearMatch = textToSearch.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
        return yearMatch[0];
    }
    
    // Try AI extraction
    return await extractUsingAI('extractYear', currentData, userId);
}

async function generateTitle(currentData, userId) {
    // If we have a filename, clean it up
    if (currentData.filename) {
        return cleanHumanFriendlyName(currentData.filename.replace(/\.pdf$/i, ''));
    }
    
    // Try AI extraction
    return await extractUsingAI('extractTitle', currentData, userId);
}

async function generateSummary(currentData, userId) {
    // Summary requires content, so always use AI
    return await extractUsingAI('extractSummary', currentData, userId);
}

async function generateKeywords(currentData, userId) {
    // Keywords require content analysis
    return await extractUsingAI('extractKeywords', currentData, userId);
}

// Generic AI extraction helper
async function extractUsingAI(promptKey, currentData, userId) {
    try {
        // Get content for AI analysis
        let contentForAnalysis = currentData.condensed || currentData.content;
        
        // If no content in Firestore, try to get it from PDF
        if (!contentForAnalysis) {
            const pdfFileName = currentData.filename || currentData.originalFilename || (currentData.title + '.pdf');
            if (pdfFileName) {
                try {
                    contentForAnalysis = await fetchAndExtractPDFText(pdfFileName);
                } catch (pdfError) {
                    console.log(`[AI_EXTRACTION] PDF extraction failed: ${pdfError.message}`);
                    return null;
                }
            }
        }
        
        if (!contentForAnalysis) {
            console.log(`[AI_EXTRACTION] No content available for ${promptKey}`);
            return null;
        }
        
        const promptConfig = global.prompts?.[promptKey] || require('./prompts.json')[promptKey];
        if (!promptConfig) {
            console.log(`[AI_EXTRACTION] No prompt config found for ${promptKey}`);
            return null;
        }
        
        const prompt = promptConfig.prompt.replace('{{text}}', contentForAnalysis.substring(0, 8000));
        
        const messages = [
            { role: 'system', content: promptConfig.system_prompt },
            { role: 'user', content: prompt }
        ];
        
        const aiResult = await routeToAI({ messages }, userId);
        
        if (aiResult && aiResult.content) {
            const extractedValue = aiResult.content.trim();
            console.log(`[AI_EXTRACTION] ${promptKey} extracted: "${extractedValue}"`);
            return extractedValue;
        }
        
        return null;
    } catch (error) {
        console.log(`[AI_EXTRACTION] ${promptKey} failed: ${error.message}`);
        return null;
    }
}

// Helper function to process a single guideline's humanFriendlyName
async function processSingleGuidelineHumanFriendlyName(doc, userId) {
    const guidelineId = doc.id;
    const currentData = doc.data();
    
    try {
        // Check if humanFriendlyName is already complete
        const hasValidHumanFriendlyName = currentData.humanFriendlyName && 
            currentData.humanFriendlyName !== 'N/A' && 
            currentData.humanFriendlyName !== 'Not available' &&
            currentData.humanFriendlyName !== 'Unknown' &&
            currentData.humanFriendlyName.length > 2;
        
        if (hasValidHumanFriendlyName) {
            return {
                status: 'already_complete',
                humanFriendlyName: currentData.humanFriendlyName
            };
        }
        
        // Process using the same logic as the batch function
        let humanFriendlyName = null;
        
        // Strategy 1: Use title if available and clean it
        if (currentData.title && currentData.title.length > 2) {
            humanFriendlyName = cleanHumanFriendlyName(currentData.title);
        }
        
        // Strategy 2: Use filename if title is not good enough
        if (!humanFriendlyName || humanFriendlyName.length < 3) {
            if (currentData.filename) {
                humanFriendlyName = cleanHumanFriendlyName(currentData.filename.replace(/\.pdf$/i, ''));
            } else if (currentData.originalFilename) {
                humanFriendlyName = cleanHumanFriendlyName(currentData.originalFilename.replace(/\.pdf$/i, ''));
            }
        }
        
        // Strategy 3: Fallback to document ID if nothing else works
        if (!humanFriendlyName || humanFriendlyName.length < 3) {
            humanFriendlyName = guidelineId.replace(/[-_]/g, ' ').replace(/\.pdf$/i, '');
            humanFriendlyName = humanFriendlyName.split(' ').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
            ).join(' ');
        }
        
        // Update the guideline with the humanFriendlyName
        if (humanFriendlyName && humanFriendlyName.length > 2) {
            await doc.ref.update({ humanFriendlyName });
            
            return {
                status: 'updated',
                oldValue: currentData.humanFriendlyName || null,
                newValue: humanFriendlyName,
                source: currentData.title ? 'title' : 'filename/fallback'
            };
        } else {
            return {
                status: 'error',
                error: 'Could not generate valid humanFriendlyName'
            };
        }
        
    } catch (error) {
        return {
            status: 'error',
            error: error.message
        };
    }
}

// New endpoint to enhance guideline metadata using AI
app.post('/enhanceGuidelineMetadata', authenticateUser, async (req, res) => {
  try {
    const { guidelineId, specificFields } = req.body;
    const userId = req.user.uid;

    if (!guidelineId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: guidelineId' 
      });
    }

    console.log(`[DEBUG] Enhancing metadata for guideline: ${guidelineId}`);

    // Get the guideline from Firestore
    const guidelineRef = db.collection('guidelines').doc(guidelineId);
    const guidelineDoc = await guidelineRef.get();

    if (!guidelineDoc.exists) {
      return res.status(404).json({ 
        success: false, 
        error: 'Guideline not found' 
      });
    }

    const currentData = guidelineDoc.data();
    console.log(`[DEBUG] Current guideline data:`, {
      title: currentData.title,
      organisation: currentData.organisation,
      yearProduced: currentData.yearProduced,
      hasContent: !!currentData.condensed || !!currentData.content
    });

    // Identify missing or incomplete fields
    const metadataFields = [
      'humanFriendlyName',
      'organisation', 
      'yearProduced',
      'doi',
      'title',
      'summary',
      'keywords'
    ];

    const missingFields = [];
    const incompleteFields = [];
    
    // Check which fields need enhancement
    const fieldsToEnhance = specificFields || metadataFields;
    
    fieldsToEnhance.forEach(field => {
      const value = currentData[field];
      if (!value || value === 'N/A' || value === 'Not available' || value === '') {
        missingFields.push(field);
      } else if (typeof value === 'string' && value.length < 3) {
        incompleteFields.push(field);
      }
    });

    console.log(`[DEBUG] Analysis results:`, {
      missingFields,
      incompleteFields,
      totalFieldsToEnhance: missingFields.length + incompleteFields.length
    });

    if (missingFields.length === 0 && incompleteFields.length === 0) {
      return res.json({
        success: true,
        message: 'No metadata enhancement needed - all requested fields are complete',
        enhancedFields: [],
        guidelineData: currentData
      });
    }

    // Get or generate content for AI analysis (prefer condensed, fall back to content)
    let contentForAnalysis = currentData.condensed || currentData.content;
    let generatedContent = null;
    let generatedCondensed = null;
    
    // If no content in Firestore, try to fetch existing text files first
    if (!contentForAnalysis) {
      console.log(`[DEBUG] No condensed/content in Firestore, trying to fetch existing text files for: ${guidelineId}`);
      
      try {
        // Try to construct the text file path from the guideline data
        let textFileName = null;
        
        if (currentData.filename) {
          textFileName = currentData.filename.replace(/\.pdf$/i, '.txt');
        } else if (currentData.originalFilename) {
          textFileName = currentData.originalFilename.replace(/\.pdf$/i, '.txt');
        } else if (currentData.title) {
          textFileName = currentData.title.replace(/\.pdf$/i, '.txt');
        }
        
        if (textFileName) {
          // Try multiple text file locations
          const textFilePaths = [
            `guidance/${encodeURIComponent(textFileName)}`,
            `guidance/condensed/${encodeURIComponent(textFileName)}`,
            `guidance/significant_terms/${encodeURIComponent(textFileName)}`,
            `guidance/summary/${encodeURIComponent(textFileName)}`
          ];
          
          for (const textFilePath of textFilePaths) {
            try {
              console.log(`[DEBUG] Attempting to fetch text file: ${textFilePath}`);
              contentForAnalysis = await getFileContents(textFilePath);
              if (contentForAnalysis) {
                console.log(`[DEBUG] Successfully fetched text content (${contentForAnalysis.length} chars) from: ${textFilePath}`);
                break;
              }
            } catch (textFileError) {
              console.log(`[DEBUG] Could not fetch ${textFilePath}: ${textFileError.message}`);
            }
          }
        }
      } catch (fetchError) {
        console.log(`[DEBUG] Error fetching existing text files: ${fetchError.message}`);
      }
    }
    
    // If still no content, generate de novo from PDF
    if (!contentForAnalysis) {
      console.log(`[DEBUG] No existing text content found, generating de novo from PDF for: ${guidelineId}`);
      
      try {
        // Determine PDF filename
        let pdfFileName = null;
        if (currentData.filename && currentData.filename.toLowerCase().endsWith('.pdf')) {
          pdfFileName = currentData.filename;
        } else if (currentData.originalFilename && currentData.originalFilename.toLowerCase().endsWith('.pdf')) {
          pdfFileName = currentData.originalFilename;
        } else if (currentData.filename) {
          pdfFileName = currentData.filename.replace(/\.[^.]+$/, '.pdf');
        } else if (currentData.title) {
          pdfFileName = currentData.title + '.pdf';
        }
        
        if (pdfFileName) {
          console.log(`[DEBUG] Attempting to extract text from PDF: ${pdfFileName}`);
          generatedContent = await fetchAndExtractPDFText(pdfFileName);
          
          if (generatedContent) {
            console.log(`[DEBUG] Successfully generated content from PDF (${generatedContent.length} chars)`);
            contentForAnalysis = generatedContent;
            
            // Also generate condensed version
            console.log(`[DEBUG] Generating condensed version from extracted content`);
            generatedCondensed = await generateCondensedText(generatedContent, userId);
            if (generatedCondensed) {
              console.log(`[DEBUG] Successfully generated condensed text (${generatedCondensed.length} chars)`);
              // Use condensed version for analysis if available
              contentForAnalysis = generatedCondensed;
            }
          }
        }
      } catch (pdfError) {
        console.log(`[DEBUG] PDF extraction failed: ${pdfError.message}`);
      }
    }
    
    // If we have content but no condensed, generate condensed version
    if (contentForAnalysis && !currentData.condensed && !generatedCondensed) {
      console.log(`[DEBUG] Content available but no condensed version, generating condensed text`);
      try {
        generatedCondensed = await generateCondensedText(contentForAnalysis, userId);
        if (generatedCondensed) {
          console.log(`[DEBUG] Successfully generated condensed text (${generatedCondensed.length} chars)`);
          // Use condensed version for analysis
          contentForAnalysis = generatedCondensed;
        }
      } catch (condenseError) {
        console.log(`[DEBUG] Condensation failed: ${condenseError.message}`);
      }
    }
    
    if (!contentForAnalysis) {
      return res.status(400).json({
        success: false,
        error: `No content available for AI analysis. Tried sources: Firestore (condensed/content), GitHub text files, PDF extraction. Please ensure the guideline "${guidelineId}" has an accessible PDF file.`
      });
    }

    // Load prompts configuration
    // Use the global prompts loaded from prompts.json instead of defaults
    const loadedPrompts = global.prompts || prompts || require('./prompts.json');
    const enhancedData = { ...currentData };
    const enhancedFields = [];
    const errors = [];

    // Define which fields to process and their corresponding prompt keys
    const fieldPromptMapping = {
      'humanFriendlyName': 'extractHumanFriendlyName',
      'organisation': 'extractOrganisation', 
      'yearProduced': 'extractYear',
      'doi': 'extractDOI',
      'title': 'extractHumanFriendlyName', // Use same prompt as humanFriendlyName
      'summary': 'extractSummary', // Will need to add this prompt
      'keywords': 'extractKeywords' // Will need to add this prompt
    };

    // Process missing and incomplete fields
    const fieldsToProcess = [...missingFields, ...incompleteFields];
    
    for (const field of fieldsToProcess) {
      try {
        console.log(`[DEBUG] Processing field: ${field}`);
        
        const promptKey = fieldPromptMapping[field];
        if (!promptKey) {
          console.log(`[DEBUG] No prompt mapping for field: ${field}, skipping...`);
          continue;
        }

        const promptConfig = loadedPrompts[promptKey];
        if (!promptConfig) {
          console.log(`[DEBUG] Prompt configuration not found for: ${promptKey}, skipping...`);
          continue;
        }

        // Create the prompt with content substitution
        const prompt = promptConfig.prompt.replace('{{text}}', contentForAnalysis);
        
        let messages;
        if (promptConfig.system_prompt) {
          messages = [
            { role: 'system', content: promptConfig.system_prompt },
            { role: 'user', content: prompt }
          ];
        } else {
          messages = [{ role: 'user', content: prompt }];
        }

        // Get AI response
        console.log(`[DEBUG] Calling AI for field: ${field}`);
        const aiResult = await routeToAI({ messages }, userId);
        
        if (aiResult && aiResult.content) {
          let extractedValue = aiResult.content.trim();
          
          // Clean up the response
          extractedValue = cleanHumanFriendlyName(extractedValue);
          
          // Validate the extracted value
          if (extractedValue && 
              extractedValue !== 'N/A' && 
              extractedValue !== 'Not available' && 
              extractedValue !== 'Unknown' &&
              extractedValue.length > 2) {
            
            enhancedData[field] = extractedValue;
            enhancedFields.push({
              field,
              oldValue: currentData[field] || null,
              newValue: extractedValue,
              action: missingFields.includes(field) ? 'added' : 'enhanced'
            });
            
            console.log(`[DEBUG] Successfully enhanced ${field}: "${extractedValue}"`);
          } else {
            console.log(`[DEBUG] Invalid or empty value for ${field}: "${extractedValue}"`);
            errors.push(`Could not extract valid ${field} from content`);
          }
        } else {
          console.log(`[DEBUG] No AI response for field: ${field}`);
          errors.push(`AI did not provide response for ${field}`);
        }
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
      } catch (error) {
        console.error(`[DEBUG] Error processing field ${field}:`, error);
        errors.push(`Error processing ${field}: ${error.message}`);
      }
    }

    // Update the guideline in Firestore if we enhanced any fields OR generated new content
    const shouldUpdate = enhancedFields.length > 0 || generatedContent || generatedCondensed;
    
    if (shouldUpdate) {
      try {
        enhancedData.lastUpdated = admin.firestore.FieldValue.serverTimestamp();
        enhancedData.metadataEnhanced = true;
        enhancedData.enhancementDate = new Date().toISOString();
        
        // Save generated content to the main guideline document
        if (generatedContent && !currentData.content) {
          enhancedData.content = generatedContent;
          console.log(`[DEBUG] Added generated content (${generatedContent.length} chars) to guideline document`);
        }
        
        await guidelineRef.update(enhancedData);
        console.log(`[DEBUG] Successfully updated guideline with enhanced metadata`);
        
        // Save generated condensed text to the separate condensed collection
        if (generatedCondensed && !currentData.condensed) {
          const condensedRef = db.collection('condensed').doc(guidelineId);
          await condensedRef.set({
            condensed: generatedCondensed,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            generatedDate: new Date().toISOString(),
            sourceType: generatedContent ? 'extracted_pdf' : 'existing_content'
          });
          console.log(`[DEBUG] Saved generated condensed text (${generatedCondensed.length} chars) to condensed collection`);
        }
        
      } catch (updateError) {
        console.error(`[DEBUG] Error updating guideline:`, updateError);
        errors.push(`Failed to save enhanced metadata: ${updateError.message}`);
      }
    }

    // Log the enhancement activity
    try {
      await logAIInteraction({
        guidelineId,
        fieldsProcessed: fieldsToProcess,
        enhancedFields: enhancedFields.length,
        contentLength: contentForAnalysis.length
      }, {
        success: enhancedFields.length > 0,
        enhancedFields,
        errors: errors.length > 0 ? errors : undefined
      }, 'enhanceGuidelineMetadata');
    } catch (logError) {
      console.error('Error logging metadata enhancement:', logError);
    }

    // Return response
    res.json({
      success: true,
      message: `Enhanced ${enhancedFields.length} field(s) for guideline ${guidelineId}`,
      enhancedFields,
      errors: errors.length > 0 ? errors : undefined,
      guidelineData: enhancedData
    });

  } catch (error) {
    console.error('[ERROR] Error in enhanceGuidelineMetadata:', error);
    res.status(500).json({ 
      success: false, 
      error: `Failed to enhance metadata: ${error.message}` 
    });
  }
});

// Endpoint to batch enhance metadata for multiple guidelines
app.post('/batchEnhanceMetadata', authenticateUser, async (req, res) => {
  try {
    const { guidelineIds, fieldsToEnhance } = req.body;
    const userId = req.user.uid;

    // Check if user is admin
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ 
        success: false, 
        error: 'Only admin users can perform batch metadata enhancement' 
      });
    }

    if (!guidelineIds || !Array.isArray(guidelineIds) || guidelineIds.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing or invalid guidelineIds array' 
      });
    }

    console.log(`[DEBUG] Batch enhancing metadata for ${guidelineIds.length} guidelines`);

    const results = [];
    const batchSize = 3; // Process in small batches to avoid overwhelming the AI service
    
    for (let i = 0; i < guidelineIds.length; i += batchSize) {
      const batch = guidelineIds.slice(i, i + batchSize);
      console.log(`[DEBUG] Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(guidelineIds.length/batchSize)}`);
      
      const batchPromises = batch.map(async (guidelineId) => {
        try {
          // Make internal API call to enhance single guideline
          const enhancementData = {
            guidelineId,
            specificFields: fieldsToEnhance
          };

          // Simulate the single enhancement call
          const mockReq = {
            body: enhancementData,
            user: req.user
          };
          
          let enhancementResult;
          const mockRes = {
            json: (data) => { enhancementResult = data; },
            status: () => mockRes
          };

          // Call the enhancement logic directly
          await new Promise((resolve) => {
            app._router.handle(mockReq, mockRes, resolve);
          });
          
          return {
            guidelineId,
            success: enhancementResult?.success || false,
            enhancedFields: enhancementResult?.enhancedFields || [],
            errors: enhancementResult?.errors || [],
            message: enhancementResult?.message || 'Unknown result'
          };
        } catch (error) {
          console.error(`[DEBUG] Error enhancing ${guidelineId}:`, error);
          return {
            guidelineId,
            success: false,
            enhancedFields: [],
            errors: [error.message],
            message: `Failed to enhance: ${error.message}`
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Delay between batches to avoid rate limiting
      if (i + batchSize < guidelineIds.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Calculate summary statistics
    const successCount = results.filter(r => r.success).length;
    const totalEnhancedFields = results.reduce((sum, r) => sum + (r.enhancedFields?.length || 0), 0);
    const totalErrors = results.reduce((sum, r) => sum + (r.errors?.length || 0), 0);

    console.log(`[DEBUG] Batch enhancement complete:`, {
      totalGuidelines: guidelineIds.length,
      successful: successCount,
      failed: guidelineIds.length - successCount,
      totalFieldsEnhanced: totalEnhancedFields,
      totalErrors
    });

    res.json({
      success: true,
      message: `Batch enhancement complete: ${successCount}/${guidelineIds.length} guidelines processed`,
      summary: {
        totalGuidelines: guidelineIds.length,
        successful: successCount,
        failed: guidelineIds.length - successCount,
        totalFieldsEnhanced: totalEnhancedFields,
        totalErrors
      },
      results
    });

  } catch (error) {
    console.error('[ERROR] Error in batchEnhanceMetadata:', error);
    res.status(500).json({ 
      success: false, 
      error: `Batch enhancement failed: ${error.message}` 
    });
  }
});

// -----------------------------------------------------------------------------
//  NEW ENDPOINT: Audit Element Check
// -----------------------------------------------------------------------------
app.post('/auditElementCheck', authenticateUser, async (req, res) => {
    const { guidelineId, auditableElement, transcript } = req.body || {};

    // Input validation
    if (!guidelineId || !auditableElement || !transcript) {
        return res.status(400).json({
            success: false,
            error: 'guidelineId, auditableElement and transcript are required'
        });
    }

    const userId = req.user.uid;

    try {
        // Fetch guideline text
        const guideline = await getGuideline(guidelineId);
        if (!guideline) {
            return res.status(404).json({ success: false, error: 'Guideline not found' });
        }
        const guidelineText = guideline.condensed || guideline.content || '';

        // Construct prompts
        const systemPrompt = `You are a compliance-checking medical AI.\n\nReturn ONLY valid JSON matching this interface:\n\ninterface AuditElementResult {\n  element: string\n  isCorrect: boolean\n  issues: string[]\n  suggestedFixes: string[]\n}`;
        const userPrompt = `GUIDELINE TEXT:\n${guidelineText}\n\nAUDITABLE ELEMENT:\n${auditableElement}\n\nTRANSCRIPT:\n${transcript}\n\nReply with JSON ONLY.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        // Send to AI
        const aiResponse = await routeToAI({ messages }, userId);
        if (!aiResponse || !aiResponse.content) {
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Helper: safely extract JSON
        const extractJson = (text) => {
            const attempt = (str) => { try { return JSON.parse(str); } catch { return null; } };
            let json = attempt(text);
            if (json) return json;
            const md = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
            if (md) {
                json = attempt(md[1]);
                if (json) return json;
            }
            const obj = text.match(/(\{[\s\S]*\})/);
            if (obj) {
                json = attempt(obj[1]);
                if (json) return json;
            }
            return null;
        };

        const resultObj = extractJson(aiResponse.content);
        if (!resultObj) {
            console.error('[auditElementCheck] JSON parse failure:', aiResponse.content.slice(0, 500));
            return res.status(500).json({ success: false, error: 'Unable to parse AI JSON response' });
        }

        // Persist to Firestore (non-blocking)
        try {
            await admin.firestore().collection('auditElementChecks').add({
                userId,
                guidelineId,
                auditableElement,
                transcript,
                result: resultObj,
                ai_provider: aiResponse.ai_provider,
                ai_model: aiResponse.ai_model,
                token_usage: aiResponse.token_usage,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
        } catch (dbErr) {
            console.error('[auditElementCheck] Firestore write error:', dbErr.message);
        }

        // Log interaction (non-blocking)
        try {
            await logAIInteraction(
                { system_prompt: systemPrompt, user_prompt: userPrompt },
                { success: true, response: aiResponse.content, ai_provider: aiResponse.ai_provider, ai_model: aiResponse.ai_model, token_usage: aiResponse.token_usage },
                'auditElementCheck'
            );
        } catch (logErr) {
            console.error('[auditElementCheck] logAIInteraction error:', logErr.message);
        }

        // Return response
        return res.json({
            success: true,
            result: resultObj,
            ai_provider: aiResponse.ai_provider,
            ai_model: aiResponse.ai_model,
            tokensUsed: aiResponse.token_usage
        });
    } catch (error) {
        console.error('[auditElementCheck] Error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('Server startup complete - performing background checks...');
    
    // Run GitHub checks in background to avoid blocking server startup
    setImmediate(async () => {
        try {
            console.log('Checking GitHub token and permissions...');
            
            // First validate token format
            validateGitHubToken();
            
            // Then check repository access with timeout
            const hasAccess = await Promise.race([
                testGitHubAccess(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('GitHub access test timeout')), 10000))
            ]);
            
            if (!hasAccess) {
                console.error('WARNING: Basic GitHub access test failed!');
            } else {
                console.log('GitHub access test passed');
            }
            
            // Finally check specific permissions with timeout
            const permissions = await Promise.race([
                checkGitHubPermissions(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('GitHub permissions check timeout')), 10000))
            ]);
            
            if (!permissions || !Object.values(permissions).slice(0, 4).every(v => v)) {
                console.error('WARNING: Some required GitHub permissions are missing!');
                console.error('Please ensure your token has the following permissions:');
                console.error('- repo (Full control of repositories)');
                console.error('- workflow (Update GitHub Action workflows)');
                console.error('- contents (Repository contents access)');
                console.error('- actions (Manage GitHub Actions)');
            } else {
                console.log('GitHub permissions check passed');
            }
        } catch (error) {
            console.error('Background GitHub checks failed:', error.message);
            console.log('Server will continue to operate with limited GitHub functionality');
        }
    });
});
// console.log('All filenames in the guidance folder:', allGuidelines.map(g => g.name));

app.get('/health', (req, res) => {
    res.status(200).json({ 
        message: 'Server is live',
        timestamp: new Date().toISOString(),
        status: 'healthy',
        port: PORT
    });
});

// Add endpoint to view AI usage statistics
app.get('/api-usage-stats', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin or has authorization
    if (!req.user || !req.user.admin) {
      // Additional check for specific user IDs that are allowed
      const allowedUsers = process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',') : [];
      if (!allowedUsers.includes(req.user.uid)) {
        console.log('Unauthorized API usage stats attempt by:', req.user.uid);
        return res.status(403).json({ 
          success: false, 
          message: 'Only admin users can view API usage statistics' 
        });
      }
    }
    
    console.log(`User ${req.user.uid} requested API usage statistics`);
    
    // Get all log files from the GitHub repository
    const response = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/logs/ai-interactions`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`
      }
    });
    
    if (!response.data || !Array.isArray(response.data)) {
      throw new Error('Invalid response from GitHub API');
    }
    
    const files = response.data.filter(file => file.name.endsWith('.json'));
    console.log(`Found ${files.length} JSON log files to analyze`);
    
    if (files.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No log files found to analyze',
        stats: {
          totalCalls: 0,
          totalTokens: 0,
          totalCost: 0,
          byProvider: {}
        }
      });
    }
    
    // Initialize statistics
    const stats = {
      totalCalls: 0,
      totalTokensUsed: 0,
      estimatedTotalCost: 0,
      byProvider: {
        OpenAI: {
          calls: 0,
          tokensUsed: 0,
          estimatedCost: 0
        },
        DeepSeek: {
          calls: 0,
          tokensUsed: 0,
          estimatedCost: 0
        },
        Anthropic: {
          calls: 0,
          tokensUsed: 0,
          estimatedCost: 0
        },
        Mistral: {
          calls: 0,
          tokensUsed: 0,
          estimatedCost: 0
        },
        Gemini: {
          calls: 0,
          tokensUsed: 0,
          estimatedCost: 0
        }
      },
      byEndpoint: {},
      byWorkflow: {}
    };
    
    // Process each file to extract token usage
    const processLimit = Math.min(files.length, 500); // Limit to 500 files for performance
    
    for (let i = 0; i < processLimit; i++) {
      try {
        const file = files[i];
        const fileUrl = file.download_url;
        
        const fileResponse = await axios.get(fileUrl);
        const logData = fileResponse.data;
        
        // Skip if not a valid log
        if (!logData || typeof logData !== 'object') continue;
        
        // Update total calls
        stats.totalCalls++;
        
        // Get provider info
        const provider = logData.ai_provider || 'Unknown';
        if (provider !== 'Unknown') {
          stats.byProvider[provider].calls++;
        }
        
        // Get endpoint info
        const endpoint = logData.endpoint || 'unknown';
        
        // Check if this is a workflow-related log
        if (endpoint.startsWith('workflow-')) {
          const workflow = logData.workflow || endpoint.substring(9); // Extract workflow name
          
          // Add to workflow stats
          if (!stats.byWorkflow[workflow]) {
            stats.byWorkflow[workflow] = {
              calls: 0,
              tokensUsed: 0,
              estimatedCost: 0
            };
          }
          
          stats.byWorkflow[workflow].calls++;
          
          if (logData.token_usage) {
            const { total_tokens, estimated_cost_usd } = logData.token_usage;
            
            if (total_tokens) {
              stats.totalTokensUsed += total_tokens;
              if (provider !== 'Unknown') {
                stats.byProvider[provider].tokensUsed += total_tokens;
              }
              stats.byWorkflow[workflow].tokensUsed += total_tokens;
            }
            
            if (estimated_cost_usd) {
              stats.estimatedTotalCost += estimated_cost_usd;
              if (provider !== 'Unknown') {
                stats.byProvider[provider].estimatedCost += estimated_cost_usd;
              }
              stats.byWorkflow[workflow].estimatedCost += estimated_cost_usd;
            }
          }
        } else {
          // Regular endpoint stats
          if (!stats.byEndpoint[endpoint]) {
            stats.byEndpoint[endpoint] = {
              calls: 0,
              tokensUsed: 0,
              estimatedCost: 0
            };
          }
          stats.byEndpoint[endpoint].calls++;
          
          // Process token usage if available
          if (logData.token_usage) {
            const { total_tokens, estimated_cost_usd } = logData.token_usage;
            
            if (total_tokens) {
              stats.totalTokensUsed += total_tokens;
              if (provider !== 'Unknown') {
                stats.byProvider[provider].tokensUsed += total_tokens;
              }
              stats.byEndpoint[endpoint].tokensUsed += total_tokens;
            }
            
            if (estimated_cost_usd) {
              stats.estimatedTotalCost += estimated_cost_usd;
              if (provider !== 'Unknown') {
                stats.byProvider[provider].estimatedCost += estimated_cost_usd;
              }
              stats.byEndpoint[endpoint].estimatedCost += estimated_cost_usd;
            }
          }
        }
      } catch (fileError) {
        console.error(`Error processing log file ${i+1}/${processLimit}:`, fileError.message);
        // Continue with next file
      }
    }
    
    // Format costs to 6 decimal places
    stats.estimatedTotalCost = parseFloat(stats.estimatedTotalCost.toFixed(6));
    stats.byProvider.OpenAI.estimatedCost = parseFloat(stats.byProvider.OpenAI.estimatedCost.toFixed(6));
    stats.byProvider.DeepSeek.estimatedCost = parseFloat(stats.byProvider.DeepSeek.estimatedCost.toFixed(6));
    stats.byProvider.Anthropic.estimatedCost = parseFloat(stats.byProvider.Anthropic.estimatedCost.toFixed(6));
    stats.byProvider.Mistral.estimatedCost = parseFloat(stats.byProvider.Mistral.estimatedCost.toFixed(6));
    stats.byProvider.Gemini.estimatedCost = parseFloat(stats.byProvider.Gemini.estimatedCost.toFixed(6));
    
    Object.keys(stats.byEndpoint).forEach(endpoint => {
      stats.byEndpoint[endpoint].estimatedCost = parseFloat(stats.byEndpoint[endpoint].estimatedCost.toFixed(6));
    });
    
    Object.keys(stats.byWorkflow).forEach(workflow => {
      stats.byWorkflow[workflow].estimatedCost = parseFloat(stats.byWorkflow[workflow].estimatedCost.toFixed(6));
    });
    
    // Return statistics
    res.json({
      success: true,
      message: `Analyzed ${processLimit} of ${files.length} log files`,
      stats,
      timestamp: new Date().toISOString(),
      note: processLimit < files.length ? 'Results limited to the most recent logs' : undefined
    });
  } catch (error) {
    console.error('Error generating API usage statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating API usage statistics',
      error: error.message
    });
  }
});

// Function to authenticate workflow requests
const authenticateWorkflow = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ message: 'No authorization header' });
  }
  try {
    // Verify workflow token
    const token = authHeader.split('Bearer ')[1];
    // Use a special workflow token stored in environment variables
    if (token === process.env.WORKFLOW_TOKEN) {
      next();
    } else {
      throw new Error('Invalid workflow token');
    }
  } catch (error) {
    console.error('Workflow authentication error:', error);
    res.status(401).json({ message: 'Invalid token' });
  }
};

// Add endpoint to receive AI usage data from GitHub workflows
app.post('/log-workflow-ai-usage', authenticateWorkflow, async (req, res) => {
  try {
    const { workflow, token_usage, model, timestamp, prompt, response, provider } = req.body;
    
    if (!workflow || !token_usage || !model) {
      return res.status(400).json({ 
        success: false, 
        message: 'Required fields missing: workflow, token_usage, and model are required' 
      });
    }
    
    console.log(`Received AI usage data from workflow ${workflow}:`, {
      model, 
      workflow,
      tokens: token_usage.total_tokens || 'unknown',
      timestamp: timestamp || new Date().toISOString()
    });
    
    // Calculate cost based on model and token usage
    let estimatedCost = 0;
    if (token_usage.prompt_tokens && token_usage.completion_tokens) {
      if (model.includes('gpt-4')) {
        // GPT-4 pricing (adjust as needed)
        estimatedCost = (token_usage.prompt_tokens / 1000) * 0.03 + 
                         (token_usage.completion_tokens / 1000) * 0.06;
      } else if (model.includes('gpt-3.5')) {
        // GPT-3.5 pricing
        estimatedCost = (token_usage.prompt_tokens / 1000) * 0.0015 + 
                         (token_usage.completion_tokens / 1000) * 0.002;
      } else if (model.includes('deepseek')) {
        // DeepSeek pricing
        estimatedCost = (token_usage.total_tokens / 1000) * 0.0005;
      } else if (model.includes('claude')) {
        // Claude pricing
        estimatedCost = (token_usage.prompt_tokens / 1000) * 0.003 + 
                         (token_usage.completion_tokens / 1000) * 0.015;
      } else if (model.includes('mistral')) {
        // Mistral pricing
        estimatedCost = (token_usage.prompt_tokens / 1000) * 0.0007 + 
                         (token_usage.completion_tokens / 1000) * 0.0028;
      } else if (model.includes('gemini')) {
        // Gemini pricing (placeholder)
        estimatedCost = (token_usage.prompt_tokens / 1000) * 0.0025 + 
                         (token_usage.completion_tokens / 1000) * 0.0075;
      } else {
        // Default pricing (OpenAI-like)
        estimatedCost = (token_usage.total_tokens / 1000) * 0.002;
      }
      
      // Add estimated cost to token usage
      token_usage.estimated_cost_usd = estimatedCost;
    }
    
    // Determine AI provider based on model name
    const ai_provider = provider || 
                        (model.includes('gpt') ? 'OpenAI' : 
                         model.includes('deepseek') ? 'DeepSeek' :
                         model.includes('claude') ? 'Anthropic' :
                         model.includes('mistral') ? 'Mistral' :
                         model.includes('gemini') ? 'Gemini' : 'Unknown');
    
    // Format data for logging
    const logData = {
      workflow,
      timestamp: timestamp || new Date().toISOString(),
      model,
      token_usage,
      ai_provider,
      ai_model: model,
      prompt: prompt || `Workflow: ${workflow}`,
      response: response || `Processed by ${workflow} workflow`
    };
    
    // Use the existing logAIInteraction function
    await logAIInteraction(
      { 
        prompt: `Workflow: ${workflow}`, 
        workflow: workflow,
        timestamp: timestamp
      },
      {
        success: true,
        content: response || `Processed by ${workflow} workflow`,
        ai_provider,
        ai_model: model,
        token_usage
      },
      `workflow-${workflow}`
    );
    
    res.json({ 
      success: true, 
      message: 'AI usage logged successfully',
      estimated_cost: estimatedCost
    });
  } catch (error) {
    console.error('Error logging workflow AI usage:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to log AI usage',
      error: error.message 
    });
  }
});

// Endpoint for generating clinical notes
app.post('/generateClinicalNote', authenticateUser, async (req, res) => {
    const { transcript, anonymisationInfo } = req.body;

    if (!transcript) {
        return res.status(400).json({ success: false, message: 'Transcript is required' });
    }

    // Log anonymisation information if provided
    if (anonymisationInfo) {
        console.log('[ANONYMISER] Server received anonymised data for clinical note generation:', {
            originalLength: anonymisationInfo.originalLength,
            anonymisedLength: anonymisationInfo.anonymisedLength,
            replacementsCount: anonymisationInfo.replacementsCount,
            riskLevel: anonymisationInfo.riskLevel,
            piiTypes: anonymisationInfo.piiTypes
        });
    }

    try {
        // Load prompts configuration
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.clinicalNote.prompt;
        
        // Replace placeholder in the prompt
        const filledPrompt = systemPrompt.replace('{{text}}', transcript);

        // Send to AI
        const response = await routeToAI(filledPrompt, req.user.uid);

        // Log the interaction
        try {
            await logAIInteraction({
                prompt: filledPrompt,
                system_prompt: systemPrompt
            }, {
                success: true,
                response
            }, 'generateClinicalNote');
        } catch (logError) {
            console.error('Error logging interaction:', logError);
        }

        // Extract content if necessary
        const noteContent = typeof response === 'object' && response.content ? response.content : response;

        res.json({ success: true, note: noteContent });
    } catch (error) {
        console.error('Error in /generateClinicalNote:', error);

        // Log the error
        try {
            await logAIInteraction({
                transcript,
                prompt: prompts.clinicalNote.prompt
            }, {
                success: false,
                error: error.message
            }, 'generateClinicalNote');
        } catch (logError) {
            console.error('Error logging failure:', logError);
        }

        res.status(500).json({ success: false, message: 'Failed to generate clinical note' });
    }
});

// Endpoint to get full guideline content
app.post('/getGuidelineContent', authenticateUser, async (req, res) => {
    console.log('[DEBUG] /getGuidelineContent called with body:', {
        filename: req.body.filename,
        userId: req.user.uid
    });

    try {
        const { filename } = req.body;
        if (!filename) {
            console.log('[DEBUG] Missing filename in request');
            return res.status(400).json({ success: false, message: 'Filename is required' });
        }

        // Get the file path for the guideline - use the filename as is
        const filePath = `guidance/condensed/${filename}`;
        console.log('[DEBUG] Looking for guideline at path:', filePath);
        
        // Verify the file exists
        console.log('[DEBUG] Checking if file exists...');
        const fileExists = await checkFolderExists(filePath);
        if (!fileExists) {
            console.log('[DEBUG] File not found at path:', filePath);
            return res.status(404).json({ success: false, message: 'Guideline not found' });
        }
        console.log('[DEBUG] File exists, proceeding to read contents');

        // Get the file contents
        console.log('[DEBUG] Attempting to read file contents...');
        const content = await getFileContents(filePath);
        if (!content) {
            console.log('[DEBUG] Failed to read file contents');
            return res.status(404).json({ success: false, message: 'Could not read guideline content' });
        }
        console.log('[DEBUG] Successfully read file contents, length:', content.length);

        res.json({ success: true, content });
        console.log('[DEBUG] Successfully sent guideline content response');
    } catch (error) {
        console.error('[DEBUG] Error in getGuidelineContent:', {
            error: error.message,
            stack: error.stack,
            filename: req.body.filename
        });
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint to get recommendations based on guideline analysis
app.post('/getRecommendations', authenticateUser, async (req, res) => {
    console.log('[DEBUG] /getRecommendations called with body:', {
        noteLength: req.body.note?.length,
        guidelineLength: req.body.guideline?.length,
        promptType: req.body.promptType,
        userId: req.user.uid
    });

    try {
        const { note, guideline, promptType } = req.body;
        if (!note || !guideline || !promptType) {
            console.log('[DEBUG] Missing required fields:', {
                hasNote: !!note,
                hasGuideline: !!guideline,
                hasPromptType: !!promptType
            });
            return res.status(400).json({ 
                success: false, 
                message: 'Note, guideline, and promptType are required' 
            });
        }

        // Get the user's AI preference
        const userId = req.user.uid;
        console.log('[DEBUG] Getting AI recommendations for user:', userId);
        
        // Prepare the prompt
        const prompt = `Note: ${note}\n\nGuideline: ${guideline}`;
        console.log('[DEBUG] Sending prompt to AI, length:', prompt.length);

        const aiResult = await routeToAI(prompt, userId);
        console.log('[DEBUG] Received AI response:', {
            success: aiResult.success,
            provider: aiResult.provider,
            contentLength: aiResult.content?.length
        });

        if (!aiResult.success) {
            console.log('[DEBUG] AI request failed:', aiResult.message);
            throw new Error(aiResult.message || 'Failed to get AI recommendations');
        }

        // Log the interaction
        console.log('[DEBUG] Logging AI interaction...');
        await logAIInteraction(prompt, aiResult.content, 'getRecommendations');
        console.log('[DEBUG] Successfully logged AI interaction');

        res.json({ 
            success: true, 
            recommendations: aiResult.content,
            aiProvider: aiResult.provider
        });
        console.log('[DEBUG] Successfully sent recommendations response');
    } catch (error) {
        console.error('[DEBUG] Error in getRecommendations:', {
            error: error.message,
            stack: error.stack,
            noteLength: req.body.note?.length,
            guidelineLength: req.body.guideline?.length,
            promptType: req.body.promptType
        });
        res.status(500).json({ success: false, message: error.message });
    }
});

// Session management functions
async function createSession(userId) {
  const sessionRef = db.collection('sessions').doc();
  const session = {
    userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    status: 'active',
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  };
  await sessionRef.set(session);
  return sessionRef.id;
}

async function updateSession(sessionId, data) {
  const sessionRef = db.collection('sessions').doc(sessionId);
  await sessionRef.update({
    ...data,
    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function storeSessionGuidelines(sessionId, userId, guidelines) {
  const batch = db.batch();
  
  // Store each guideline
  for (const guideline of guidelines) {
    const docRef = db.collection('sessionGuidelines').doc();
    batch.set(docRef, {
      sessionId,
      userId,
      id: guideline.id, // Use document ID
      name: guideline.name,
      content: guideline.content,
      relevance: guideline.relevance,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  await batch.commit();
}

async function storeGuidelineCheck(sessionId, userId, id, checkResult) {
  const checkRef = db.collection('guidelineChecks').doc();
  await checkRef.set({
    sessionId,
    userId,
    id, // Use document ID
    result: checkResult,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Update the handleGuidelines endpoint
app.post('/checkGuidelinesCompliance', async (req, res) => {
  try {
    const { prompt, filenames, summaries, userId } = req.body;
    
    if (!prompt || !filenames || !summaries || !userId) {
      throw new Error('Missing required fields');
    }
    
    if (filenames.length !== summaries.length) {
      throw new Error('Mismatch between filenames and summaries arrays');
    }

    // Create a new session
    const sessionId = await createSession(userId);
    
    // Format guidelines for AI processing
    const guidelinesList = filenames.map((filename, index) => `${filename} - ${summaries[index]}`).join('\n');
    
    // Process with AI
    const systemPrompt = "You are a medical guidelines analyzer. Your task is to identify which guidelines are most relevant to the given medical case. For each guideline, provide a relevance score from 0-100 and a brief explanation of why it's relevant or not.";
    const userPrompt = `Medical Case:\n${prompt}\n\nAvailable Guidelines:\n${guidelinesList}`;
    
    const aiResult = await routeToAI(userPrompt, userId);
    const aiResponse = aiResult && typeof aiResult === 'object' ? aiResult.content : aiResult;
    
    if (!aiResponse) {
      throw new Error('Invalid response format from AI service');
    }
    
    // Parse AI response and categorize guidelines
    const relevantGuidelines = [];
    const potentiallyRelevantGuidelines = [];
    const lessRelevantGuidelines = [];
    const notRelevantGuidelines = [];

    // Process each guideline from the AI response
    const lines = aiResponse.split('\n');
    for (const line of lines) {
      if (line.trim() && !line.startsWith('Guideline')) {
        const [name, ...rest] = line.split(':');
        const content = rest.join(':').trim();
        
        const guideline = {
          id: filenames[filenames.indexOf(name.trim())],
          name: name.trim(),
          content: content,
          relevance: content.includes('highly relevant') ? 'high' :
                    content.includes('potentially relevant') ? 'medium' :
                    content.includes('less relevant') ? 'low' : 'none'
        };

        switch (guideline.relevance) {
          case 'high':
            relevantGuidelines.push(guideline);
            break;
          case 'medium':
            potentiallyRelevantGuidelines.push(guideline);
            break;
          case 'low':
            lessRelevantGuidelines.push(guideline);
            break;
          default:
            notRelevantGuidelines.push(guideline);
        }
      }
    }

    // Store guidelines in Firestore
    await storeSessionGuidelines(sessionId, userId, [
      ...relevantGuidelines,
      ...potentiallyRelevantGuidelines,
      ...lessRelevantGuidelines,
      ...notRelevantGuidelines
    ]);

    // Return response with session ID
    res.json({
      sessionId,
      relevantGuidelines,
      potentiallyRelevantGuidelines,
      lessRelevantGuidelines,
      notRelevantGuidelines
    });

  } catch (error) {
    console.error('Error in handleGuidelines:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update the checkAgainstGuidelines endpoint
app.post('/checkAgainstGuidelines', async (req, res) => {
  try {
    const { sessionId, userId, transcript } = req.body;
    
    if (!sessionId || !userId || !transcript) {
      throw new Error('Missing required fields');
    }

    // Get guidelines for this session
    const guidelinesSnapshot = await db.collection('sessionGuidelines')
      .where('sessionId', '==', sessionId)
      .where('userId', '==', userId)
      .get();

    if (guidelinesSnapshot.empty) {
      throw new Error('No guidelines found for this session');
    }

    const guidelines = guidelinesSnapshot.docs.map(doc => doc.data());
    
    // Process each guideline with AI
    const results = [];
    for (const guideline of guidelines) {
      const systemPrompt = "You are a medical guidelines compliance checker. Your task is to analyze if the given medical case follows the specified guideline. Provide a detailed analysis and specific recommendations if the case doesn't comply.";
      const userPrompt = `Medical Case:\n${transcript}\n\nGuideline to check:\n${guideline.name} - ${guideline.content}`;
      
      const aiResult = await routeToAI(userPrompt, userId);
      const analysisContent = aiResult && typeof aiResult === 'object' ? aiResult.content : aiResult;
      
      if (!analysisContent) {
        throw new Error('Invalid response format from AI service');
      }

      const checkResult = {
        id: guideline.id,
        name: guideline.name,
        analysis: analysisContent,
        timestamp: new Date().toISOString()
      };

      // Store check result
      await storeGuidelineCheck(sessionId, userId, guideline.id, checkResult);
      results.push(checkResult);
    }

    res.json({ results });

  } catch (error) {
    console.error('Error in checkAgainstGuidelines:', error);
    res.status(500).json({ error: error.message });
  }
});

// Guideline management functions
async function storeGuideline(guidelineData) {
    try {
        const { organisation, yearProduced, title, filename } = guidelineData;
        
        // Generate proper downloadUrl
        const encodedFilename = encodeURIComponent(filename);
        const downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
        
        // Generate clean document ID from filename
        const docId = generateCleanDocId(guidelineData.filename || guidelineData.title);
        console.log(`[DEBUG] Generated clean doc ID: "${docId}" from "${guidelineData.filename || guidelineData.title}"`);
        
        // Check if document already exists to preserve existing fileHash
        const guidelineRef = db.collection('guidelines').doc(docId);
        const existingDoc = await guidelineRef.get();
        
        const guidelineDoc = {
            ...guidelineData,
            downloadUrl, // Add the download URL
            fileHash: guidelineData.fileHash || (existingDoc.exists ? existingDoc.data().fileHash : null), // Preserve existing hash or add new one
            createdAt: existingDoc.exists ? existingDoc.data().createdAt : admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            processed: true // Mark as fully processed
        };
        
        const batch = db.batch();
        
        // Store main guideline with clean structure - use set to update or create
        batch.set(guidelineRef, guidelineDoc);
        
        // Note: No longer storing in separate collections - all data goes in main guidelines collection
        
        await batch.commit();
        return docId;
    } catch (error) {
        console.error('Error storing guideline:', error);
        throw error;
    }
}

// Generate clean slug-based document ID from filename
function generateCleanDocId(filename) {
  // Remove file extension and convert to lowercase
  const withoutExtension = filename.replace(/\.[^/.]+$/, '');
  
  // Convert to slug: lowercase, replace special chars with hyphens, remove multiple hyphens
  const slug = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
  
  // Add file extension back if it was a PDF
  const extension = filename.match(/\.[^/.]+$/)?.[0];
  if (extension && extension.toLowerCase() === '.pdf') {
    return `${slug}-pdf`;
  }
  
  return slug;
}
async function getGuideline(id) {
  const guideline = await db.collection('guidelines').doc(id).get();

  if (!guideline.exists) {
    throw new Error('Guideline not found');
  }

  const data = guideline.data();
  return {
    id,
    title: data.title,
    content: data.content,
    summary: data.summary || null,
    keywords: data.keywords || [],
    condensed: data.condensed || null,
    ...data // Include all other fields
  };
}

async function getAllGuidelines() {
  try {
    // console.log('[DEBUG] getAllGuidelines function called');
    
    // Check if database is available
    if (!db) {
      console.log('[DEBUG] Firestore database not available, returning empty guidelines');
      return [];
    }

    console.log('[DEBUG] Fetching guidelines collections from Firestore');
    
    // Add timeout and better error handling for Firestore queries
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firestore query timeout')), 10000)
    );

    const fetchCollections = async () => {
      return await Promise.all([
        db.collection('guidelines').get(),
        db.collection('guidelineSummaries').get(),
        db.collection('guidelineKeywords').get(),
        db.collection('guidelineCondensed').get()
      ]);
    };

    const [guidelines, summaries, keywords, condensed] = await Promise.race([
      fetchCollections(),
      timeout
    ]);

    // console.log('[DEBUG] Collection sizes:', {
    //   guidelines: guidelines.size,
    //   summaries: summaries.size,
    //   keywords: keywords.size,
    //   condensed: condensed.size
    // });

    const guidelineMap = new Map();
    
    // Process main guidelines
    guidelines.forEach(doc => {
      const data = doc.data();
      console.log(`[DEBUG] Processing guideline: ${doc.id}`);
      
      guidelineMap.set(doc.id, {
        ...data,
        id: doc.id
      });
    });

    // Add summaries
    summaries.forEach(doc => {
      const guideline = guidelineMap.get(doc.id);
      if (guideline) {
        guideline.summary = doc.data().summary;
      }
    });

    // Add keywords
    keywords.forEach(doc => {
      const guideline = guidelineMap.get(doc.id);
      if (guideline) {
        guideline.keywords = doc.data().keywords;
      }
    });

    // Add condensed versions
    condensed.forEach(doc => {
      const guideline = guidelineMap.get(doc.id);
      if (guideline) {
        guideline.condensed = doc.data().condensed;
      }
    });

    const result = Array.from(guidelineMap.values());
    console.log('[DEBUG] Returning', result.length, 'guidelines');
    return result;
  } catch (error) {
    console.error('[ERROR] Error in getAllGuidelines function:', {
      message: error.message,
      stack: error.stack,
      errorType: error.constructor.name,
      firestoreAvailable: !!db
    });
    
    // If it's a crypto/auth error, return empty array to allow app to function
    if (error.message.includes('DECODER routines') || 
        error.message.includes('timeout')) {
      console.log('[DEBUG] Returning empty guidelines due to authentication/connectivity issues');
      return [];
    }
    
    throw error;
  }
}

// Add endpoint to sync guidelines from GitHub to Firestore
app.post('/syncGuidelines', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin (include specific admin email)
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('[DEBUG] Admin user authorized for sync:', req.user.email);

    // Get all guidelines from GitHub
    const guidelines = await getGuidelinesList();
        console.log('[DEBUG] Found guidelines in GitHub:', guidelines.length);
    
    // Process each guideline
    for (const guideline of guidelines) {
            console.log(`[DEBUG] Processing guideline: ${guideline}`);
            try {
                // Convert guideline filename to the correct format for summary
                const summaryFilename = guideline.replace(/\.pdf$/i, '.txt');
                console.log(`[DEBUG] Looking for summary file: ${summaryFilename}`);
                
      const content = await getFileContents(`guidance/condensed/${guideline}`);
                const summary = await getFileContents(`guidance/summary/${summaryFilename}`);
                
                if (!summary) {
                    console.warn(`[WARNING] No summary found for guideline: ${guideline}`);
                    continue;
                }
                
                // Extract keywords from summary
      const keywords = extractKeywords(summary);
      
      // Store in Firestore
      await storeGuideline({
        id: guideline,
        title: guideline,
        content,
        summary,
        keywords,
        condensed: content // Using the same content for now
      });
                
                console.log(`[DEBUG] Successfully stored guideline: ${guideline}`);
            } catch (error) {
                console.error(`[ERROR] Failed to process guideline ${guideline}:`, error);
            }
        }

        res.json({ 
            success: true, 
            message: 'Guidelines synced successfully',
            count: guidelines.length
        });
  } catch (error) {
        console.error('[ERROR] Error syncing guidelines:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to extract keywords from text
function extractKeywords(text) {
  // Simple keyword extraction - you might want to use a more sophisticated approach
  const words = text.toLowerCase().split(/\W+/);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 'as', 'of']);
  
  const wordFreq = new Map();
  words.forEach(word => {
    if (word.length > 3 && !stopWords.has(word)) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  });

  return Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

// Function to extract auditable elements from guideline content using AI
async function extractAuditableElements(content, aiProvider = 'DeepSeek') {
  if (!content || typeof content !== 'string') {
    return [];
  }
  
  try {
    const prompt = `You are a clinical guideline auditor. Your task is to extract clinically relevant auditable elements from this guideline.

CRITICAL REQUIREMENTS:
1. Parse the guideline carefully to identify ALL clinically relevant advice
2. Order elements by clinical significance (most significant first)
3. No upper limit on number of elements
4. Each element must describe:
   - Input variables/conditions that determine the advice
   - The derived clinical advice/action
   - Clinical context and reasoning

OUTPUT FORMAT:
Return a JSON array of objects, each with:
{
  "type": "clinical_advice",
  "name": "Brief description of the clinical decision point",
  "element": "Detailed description including input variables and derived advice",
  "significance": "high|medium|low",
  "inputVariables": ["variable1", "variable2"],
  "derivedAdvice": "The specific clinical action/advice"
}

EXAMPLE:
{
  "type": "clinical_advice",
  "name": "CTG monitoring for reduced fetal movements at 26+ weeks",
  "element": "If patient reports reduced fetal movements at 26+0 weeks or later, perform computerized CTG within 2 hours. Input variables: gestational age (≥26+0 weeks), patient report of reduced movements, absence of other risk factors. Derived advice: Immediate CTG monitoring within 2 hours of report.",
  "significance": "high",
  "inputVariables": ["gestational_age", "fetal_movement_report", "risk_factors"],
  "derivedAdvice": "Perform computerized CTG within 2 hours"
}

Guideline content:
${content}

Extract ALL clinically relevant auditable elements, ordered by significance. Focus on actionable clinical decisions that can be audited for accuracy.`;

    const result = await routeToAI({ 
      messages: [
        { 
          role: 'system', 
          content: 'You are a clinical guideline auditor. Extract auditable elements in JSON format only.' 
        },
        { 
          role: 'user', 
          content: prompt 
        }
      ]
    }, null, aiProvider);

    if (result && result.content) {
      try {
        // Clean the response - remove markdown code blocks if present
        let cleanedContent = result.content.trim();
        
        // Remove ```json and ``` markers if present
        if (cleanedContent.startsWith('```json')) {
          cleanedContent = cleanedContent.replace(/^```json\s*/, '');
        }
        if (cleanedContent.startsWith('```')) {
          cleanedContent = cleanedContent.replace(/^```\s*/, '');
        }
        if (cleanedContent.endsWith('```')) {
          cleanedContent = cleanedContent.replace(/\s*```$/, '');
        }
        
        // Try to parse the cleaned response as JSON
        const parsed = JSON.parse(cleanedContent);
        if (Array.isArray(parsed)) {
          return parsed;
        } else if (parsed.auditableElements && Array.isArray(parsed.auditableElements)) {
          return parsed.auditableElements;
        }
      } catch (parseError) {
        console.error('[DEBUG] Failed to parse AI response as JSON:', parseError);
        console.log('[DEBUG] AI response was:', result.content);
      }
    }
    
    // Fallback to empty array if AI extraction fails
    return [];
    
  } catch (error) {
    console.error('[DEBUG] Error extracting auditable elements with AI:', error);
    return [];
  }
}

// Endpoint to extract metadata from a guideline using AI
app.post('/extractGuidelineMetadata', authenticateUser, async (req, res) => {
    try {
        let { guidelineText, filename, fields } = req.body;
        if ((!guidelineText && !filename) || !fields || !Array.isArray(fields) || fields.length === 0) {
            return res.status(400).json({ success: false, message: 'Must provide guidelineText or filename, and a non-empty array of fields.' });
        }

        // If only filename is provided, fetch the guideline text from GitHub
        if (!guidelineText && filename) {
            // Try condensed first, then fallback to summary
            try {
                const condensedPath = `guidance/condensed/${filename}`;
                const summaryPath = `guidance/summary/${filename}`;
                try {
                    const content = await getFileContents(condensedPath);
                    guidelineText = typeof content === 'string' ? content : (content.content || '');
                } catch (err) {
                    // Fallback to summary
                    const content = await getFileContents(summaryPath);
                    guidelineText = typeof content === 'string' ? content : (content.content || '');
                }
            } catch (fetchErr) {
                return res.status(404).json({ success: false, message: 'Could not fetch guideline text from GitHub.' });
            }
        }

        if (!guidelineText) {
            return res.status(400).json({ success: false, message: 'No guideline text available to analyze.' });
        }

        // Validate that guidelineText is a string
        if (typeof guidelineText !== 'string') {
            console.error('[EXTRACT_META] guidelineText is not a string, type:', typeof guidelineText, 'value:', guidelineText);
            return res.status(400).json({ 
                success: false, 
                message: 'guidelineText must be a string. PDFs need to be processed with a text extraction tool first.',
                receivedType: typeof guidelineText,
                isBuffer: Buffer.isBuffer(guidelineText),
                length: guidelineText?.length
            });
        }

        // Extract metadata using specific prompts for each field
        const extractedMetadata = {};
        
        // Map field names to prompt keys
        const fieldToPromptMap = {
          'humanFriendlyName': 'extractHumanFriendlyName',
          'organisation': 'extractOrganisation', 
          'yearProduced': 'extractYear',
          'doi': 'extractDOI'
        };
        
        for (const field of fields) {
          try {
            const promptKey = fieldToPromptMap[field];
            if (!promptKey) {
              console.error(`[EXTRACT_META] No prompt mapping found for field: ${field}`);
              extractedMetadata[field] = null;
              continue;
            }
            
            const promptConfig = prompts[promptKey];
            if (!promptConfig) {
              console.error(`[EXTRACT_META] Prompt not found for key: ${promptKey}`);
              extractedMetadata[field] = null;
              continue;
            }
            
            const extractPrompt = promptConfig.prompt.replace('{{text}}', guidelineText.substring(0, 6000));
            
            let messages;
            if (promptConfig.system_prompt) {
              messages = [
                { role: 'system', content: promptConfig.system_prompt },
                { role: 'user', content: extractPrompt }
              ];
            } else {
              messages = [{ role: 'user', content: extractPrompt }];
            }
            
            const result = await routeToAI({ messages }, req.user.uid);
            
            if (result && result.content) {
              const extractedValue = result.content.trim();
              if (extractedValue && extractedValue !== 'N/A' && extractedValue !== 'Not available') {
                extractedMetadata[field] = extractedValue;
              } else {
                extractedMetadata[field] = null;
              }
            } else {
              extractedMetadata[field] = null;
            }
          } catch (error) {
            console.error(`[EXTRACT_META] Failed to extract ${field}:`, error);
            extractedMetadata[field] = null;
          }
        }

        // Set a dummy aiResult for backward compatibility
        const aiResult = { content: JSON.stringify(extractedMetadata, null, 2) };
        let aiContent = aiResult && typeof aiResult === 'object' ? aiResult.content : aiResult;
        if (!aiContent) {
            throw new Error('No response from AI');
        }

        // Use the extracted metadata directly
        const metadata = extractedMetadata;

        res.json({ success: true, metadata, aiContent });
    } catch (error) {
        console.error('Error in /extractGuidelineMetadata:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Endpoint to sync guidelines from GitHub to Firestore with metadata
app.post('/syncGuidelinesWithMetadata', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin (include specific admin email)
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('[DEBUG] Admin user authorized for metadata sync:', req.user.email);

    // Get all guidelines from GitHub
    const guidelinesString = await getGuidelinesList();
    const guidelines = guidelinesString.split('\n').filter(line => line.trim()); // Split into an array of filenames
    const results = [];

    if (!guidelines || guidelines.length === 0) {
        console.log('[DEBUG] getGuidelinesList returned no guidelines (or the list was empty). Nothing to sync.');
        return res.json({ success: true, message: 'No new guidelines to sync from GitHub list.', results });
    }

    // Process each guideline
    for (const rawGuidelineName of guidelines) {
      const guideline = encodeURIComponent(rawGuidelineName.trim()); // URL encode the filename
      console.log(`[SYNC_META] Processing guideline (raw: "${rawGuidelineName}", encoded: "${guideline}")`);
      
      try {
        // Generate clean ID and check if guideline already exists
        const cleanId = generateCleanDocId(rawGuidelineName);
        const guidelineRef = db.collection('guidelines').doc(cleanId);
        const guidelineDoc = await guidelineRef.get();

        if (guidelineDoc.exists) {
          console.log(`[SYNC_META] Guideline ${rawGuidelineName} (ID: ${cleanId}) already exists in Firestore. Skipping.`);
          results.push({ guideline: rawGuidelineName, success: true, message: 'Guideline already exists in Firestore' });
          continue;
        }
        console.log(`[SYNC_META] Guideline ${rawGuidelineName} (ID: ${cleanId}) not found in Firestore. Proceeding with sync.`);

        // For PDF files, look for text version in condensed folder
        let contentPath, summaryPath;
        if (rawGuidelineName.toLowerCase().endsWith('.pdf')) {
          // Look for condensed text version - try different extensions
          const baseName = rawGuidelineName.replace(/\.pdf$/i, '');
          contentPath = `guidance/condensed/${encodeURIComponent(baseName + '.txt')}`;
          summaryPath = `guidance/summary/${encodeURIComponent(baseName + '.txt')}`; // Use summary file for summary
        } else {
          contentPath = `guidance/condensed/${encodeURIComponent(rawGuidelineName)}`;
          summaryPath = `guidance/summary/${encodeURIComponent(rawGuidelineName)}`; // Use summary file for summary
        }

        console.log(`[SYNC_META] Fetching content from: ${contentPath}`);
        console.log(`[SYNC_META] Fetching summary from: ${summaryPath}`);

        // Fetch content and summary
        const guidelineContent = await getFileContents(contentPath);
        const guidelineSummary = await getFileContents(summaryPath);

        if (!guidelineContent) {
          throw new Error(`No readable content found for ${rawGuidelineName}. Check if condensed text version exists at ${contentPath}`);
        }

        if (!guidelineSummary) {
          console.warn(`[WARNING] No summary found for guideline: ${rawGuidelineName}`);
        }

        // Extract metadata using AI directly instead of HTTP call
        console.log(`[SYNC_META] Extracting metadata for ${guideline}...`);
        const metadata = {};
        
        // Define field mappings to their specific prompts
        const fieldsToExtract = {
          'humanFriendlyName': 'extractHumanFriendlyName',
          'yearProduced': 'extractYear',
          'organisation': 'extractOrganisation',
          'doi': 'extractDOI'
        };

        for (const [field, promptKey] of Object.entries(fieldsToExtract)) {
          try {
            const promptConfig = prompts[promptKey];
            if (!promptConfig) {
              console.error(`[SYNC_META] Prompt not found for field ${field} (${promptKey})`);
              continue;
            }
            
            const extractPrompt = promptConfig.prompt.replace('{{text}}', guidelineContent);
            
            let messages;
            if (promptConfig.system_prompt) {
              messages = [
                { role: 'system', content: promptConfig.system_prompt },
                { role: 'user', content: extractPrompt }
              ];
            } else {
              messages = [{ role: 'user', content: extractPrompt }];
            }
            
            const result = await routeToAI({ messages });
            
            if (result && result.content) {
              const extractedValue = result.content.trim();
              if (extractedValue && extractedValue !== 'N/A' && extractedValue !== 'Not available') {
                metadata[field] = extractedValue;
                console.log(`[SYNC_META] Extracted ${field} for ${guideline}:`, extractedValue);
              }
            }
          } catch (error) {
            console.error(`[SYNC_META] Failed to extract ${field} for ${guideline}:`, error);
          }
        }
        
        console.log(`[SYNC_META] Successfully extracted metadata for ${guideline}:`, metadata);

        // Store in Firestore with metadata and clean ID structure
        console.log(`[SYNC_META] Storing ${rawGuidelineName} with clean ID in Firestore...`);
        await storeGuideline({
          filename: rawGuidelineName, // Original filename for GitHub reference
          title: metadata.humanFriendlyName || rawGuidelineName, // Use AI-extracted clean name as main title
          content: guidelineContent,
          summary: guidelineSummary,
          keywords: extractKeywords(guidelineSummary),
          condensed: guidelineContent,
          humanFriendlyName: metadata.humanFriendlyName || rawGuidelineName, // Clean AI-extracted official title
          humanFriendlyTitle: rawGuidelineName, // Original filename for reference
          yearProduced: metadata.yearProduced,
          organisation: metadata.organisation,
          doi: metadata.doi,
          auditableElements: await extractAuditableElements(guidelineContent)
        });
        console.log(`[SYNC_META] Successfully stored ${rawGuidelineName} (ID: ${cleanId}) in Firestore.`);

        results.push({ guideline: rawGuidelineName, success: true, message: 'Guideline synced successfully', cleanId });
      } catch (error) {
        console.error(`[SYNC_META] Error processing guideline ${rawGuidelineName} (encoded: ${guideline}):`, error.message);
        results.push({ guideline: rawGuidelineName, success: false, error: error.message });
      }
    }

    // After processing all guidelines, cleanup stale records
    console.log('[SYNC_META] Starting cleanup of stale Firestore records...');
    let cleanupResults = { deletedCount: 0, deletedFiles: [] };
    
    try {
        // Get all guidelines from Firestore
        const firestoreSnapshot = await db.collection('guidelines').get();
        const firestoreGuidelines = [];
        firestoreSnapshot.forEach(doc => {
            const data = doc.data();
            firestoreGuidelines.push({
                id: doc.id,
                filename: data.filename || data.originalFilename || data.title,
                data: data
            });
        });
        console.log(`[SYNC_META] Found ${firestoreGuidelines.length} guidelines in Firestore`);

        // Find Firestore records that don't exist in GitHub
        const toDelete = [];
        for (const firestoreGuideline of firestoreGuidelines) {
            const filename = firestoreGuideline.filename;
            if (filename && !guidelines.includes(filename)) {
                toDelete.push(firestoreGuideline);
                console.log(`[SYNC_META] Marking for deletion: ${filename} (ID: ${firestoreGuideline.id})`);
            }
        }

        if (toDelete.length > 0) {
            console.log(`[SYNC_META] Cleaning up ${toDelete.length} stale records`);
            
            // Delete stale records in batches
            const batchSize = 500;
            let deletedCount = 0;
            
            for (let i = 0; i < toDelete.length; i += batchSize) {
                const batch = db.batch();
                const batchItems = toDelete.slice(i, i + batchSize);
                
                batchItems.forEach(item => {
                    const docRef = db.collection('guidelines').doc(item.id);
                    batch.delete(docRef);
                });
                
                await batch.commit();
                deletedCount += batchItems.length;
                console.log(`[SYNC_META] Deleted batch of ${batchItems.length} records (total: ${deletedCount})`);
            }
            
            cleanupResults = {
                deletedCount: deletedCount,
                deletedFiles: toDelete.map(item => ({
                    id: item.id,
                    filename: item.filename
                }))
            };
            
            console.log(`[SYNC_META] Cleanup completed: ${deletedCount} stale records removed`);
        } else {
            console.log('[SYNC_META] No stale records found to cleanup');
        }
    } catch (cleanupError) {
        console.error('[SYNC_META] Error during cleanup phase:', cleanupError);
        // Don't fail the sync if cleanup fails
    }

    console.log('[SYNC_META] Finished processing all guidelines.', results);
    res.json({ 
        success: true, 
        results,
        cleanup: cleanupResults
    });
  } catch (error) {
    console.error('[SYNC_META] Critical error in /syncGuidelinesWithMetadata endpoint:', error);
    res.status(500).json({ error: error.message, details: 'Outer catch block in /syncGuidelinesWithMetadata' });
  }
});

// Endpoint to get guidelines list from GitHub
app.get('/getGuidelinesList', authenticateUser, async (req, res) => {
    try {
        // console.log('[DEBUG] getGuidelinesList endpoint called');
        const guidelinesString = await getGuidelinesList();
        res.send(guidelinesString);
    } catch (error) {
        console.error('[ERROR] Failed to get guidelines list:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ---- Per-user guideline preferences (Firestore) ----
function sanitizeIdForDoc(str) {
    return (str || '')
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 150) || 'item';
}

// GET: return user's included/excluded canonicalIds and excluded URLs
app.get('/userGuidelinePrefs', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        if (!db) {
            return res.json({ success: true, includedCanonicalIds: [], excludedCanonicalIds: [], excludedSourceUrls: [] });
        }
        const colRef = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
        const snapshot = await colRef.get();
        const includedCanonicalIds = [];
        const excludedCanonicalIds = [];
        const excludedSourceUrls = [];
        snapshot.forEach(doc => {
            const d = doc.data() || {};
            if (d.type === 'included' && d.canonicalId) includedCanonicalIds.push(d.canonicalId);
            if (d.type === 'excluded' && d.canonicalId) excludedCanonicalIds.push(d.canonicalId);
            if (d.type === 'excluded' && d.normalisedUrl) excludedSourceUrls.push(d.normalisedUrl);
        });
        res.json({ success: true, includedCanonicalIds, excludedCanonicalIds, excludedSourceUrls });
    } catch (error) {
        console.error('[PREFS] GET error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST: update a single preference entry
// Body: { canonicalId, status: 'included'|'excluded'|'unset', reason? } OR { url, status: 'excluded'|'unset', reason? }
app.post('/userGuidelinePrefs/update', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Firestore unavailable' });
        }
        const { canonicalId, url, status, reason } = req.body || {};
        if (!status || !['included', 'excluded', 'unset'].includes(status)) {
            return res.status(400).json({ success: false, error: 'Invalid status' });
        }
        if (!canonicalId && !url) {
            return res.status(400).json({ success: false, error: 'Provide canonicalId or url' });
        }

        const baseCol = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
        let keyType, keyValue, docId;
        if (canonicalId) {
            keyType = 'cid';
            keyValue = canonicalId;
        } else {
            keyType = 'url';
            keyValue = normalizeUrl(url);
        }
        docId = `${status === 'included' ? 'inc' : 'exc'}-${keyType}-${sanitizeIdForDoc(keyValue)}`;
        const docRef = baseCol.doc(docId);

        if (status === 'unset') {
            await docRef.delete();
            return res.json({ success: true, action: 'deleted' });
        }

        const payload = {
            type: status,
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
            addedBy: req.user.email || userId
        };
        if (canonicalId) {
            payload.canonicalId = canonicalId;
        } else {
            payload.url = url;
            payload.normalisedUrl = keyValue;
        }
        if (reason) payload.reason = reason;

        await docRef.set(payload, { merge: true });
        res.json({ success: true, action: 'upserted' });
    } catch (error) {
        console.error('[PREFS] UPDATE error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST: reconcile an 'included' preference by URL/filename to canonicalId once available
// Body: { url?, filename? }
app.post('/reconcileUserInclude', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        if (!db) {
            return res.status(503).json({ success: false, error: 'Firestore unavailable' });
        }
        let { url, filename } = req.body || {};
        if (!url && !filename) {
            return res.status(400).json({ success: false, error: 'Provide url or filename' });
        }

        const guidelinesCol = db.collection('guidelines');
        let doc = null;

        // Try by filename -> doc id
        if (filename) {
            try {
                const docId = generateCleanDocId(filename);
                const snap = await guidelinesCol.doc(docId).get();
                if (snap.exists) {
                    doc = { id: snap.id, data: snap.data() };
                }
            } catch (_) {}
        }

        // Try by downloadUrl
        if (!doc && url) {
            try {
                const norm = normalizeUrl(url);
                const qs = await guidelinesCol.where('downloadUrl', '==', url).get();
                if (!qs.empty) {
                    const d = qs.docs[0];
                    doc = { id: d.id, data: d.data() };
                } else {
                    const qs2 = await guidelinesCol.where('downloadUrl', '==', norm).get();
                    if (!qs2.empty) {
                        const d = qs2.docs[0];
                        doc = { id: d.id, data: d.data() };
                    }
                }
            } catch (_) {}
        }

        if (!doc) {
            return res.json({ success: true, reconciled: false, message: 'Guideline not yet found in Firestore' });
        }

        const canonicalId = (doc.data && doc.data.canonicalId) ? String(doc.data.canonicalId) : doc.id;

        // Upsert included by canonicalId
        const baseCol = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
        const cidDocId = `inc-cid-${sanitizeIdForDoc(canonicalId)}`;
        await baseCol.doc(cidDocId).set({
            type: 'included',
            canonicalId: canonicalId,
            addedAt: admin.firestore.FieldValue.serverTimestamp(),
            addedBy: req.user.email || userId
        }, { merge: true });

        // Best-effort: remove URL-based include if present
        if (url) {
            const norm = normalizeUrl(url);
            const urlDocId = `inc-url-${sanitizeIdForDoc(norm)}`;
            await baseCol.doc(urlDocId).delete().catch(() => {});
        }

        res.json({ success: true, reconciled: true, canonicalId });
    } catch (error) {
        console.error('[PREFS] RECONCILE error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint: get guidance exclusions (JSONL)
app.get('/guidance-exclusions', authenticateUser, async (req, res) => {
    try {
        const entries = await readExclusionsFile();
        res.json({ success: true, items: entries });
    } catch (error) {
        console.error('[ERROR] Failed to read exclusions:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint: append to guidance exclusions (JSONL)
app.post('/guidance-exclusions', authenticateUser, async (req, res) => {
    try {
        const userId = req.user?.uid;
        const userEmail = req.user?.email;
        const { url, reason, title } = req.body || {};
        if (!url) {
            return res.status(400).json({ success: false, error: 'url is required' });
        }
        const result = await appendExclusionEntry({
            url,
            reason: reason || 'excluded',
            title: title || null,
            addedBy: userEmail || userId || 'system'
        });
        res.json({ success: true, skipped: !!result.skipped });
    } catch (error) {
        console.error('[ERROR] Failed to append exclusion:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint: add filename to guidance/list_of_guidelines.txt
app.post('/addToGuidelinesList', authenticateUser, async (req, res) => {
    try {
        const { filename } = req.body || {};
        if (!filename) {
            return res.status(400).json({ success: false, error: 'filename is required' });
        }
        await updateGuidelinesMasterList(filename);
        res.json({ success: true });
    } catch (error) {
        console.error('[ERROR] Failed to update guidelines list:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Endpoint: Import guideline from a remote URL (server-side fetch to avoid CORS)
app.post('/importGuidelineFromUrl', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { url, filename, markIncluded } = req.body || {};
        if (!url) {
            return res.status(400).json({ success: false, error: 'url is required' });
        }

        // Allowlist of official domains
        const allowedHosts = new Set(['www.rcog.org.uk', 'rcog.org.uk', 'www.nice.org.uk', 'nice.org.uk']);
        let parsed;
        try {
            parsed = new URL(url);
        } catch (_) {
            return res.status(400).json({ success: false, error: 'Invalid URL' });
        }
        if (!allowedHosts.has(parsed.hostname)) {
            return res.status(400).json({ success: false, error: 'Domain not allowed' });
        }

        // Fetch file (follow PDF link if the URL is a page)
        const commonHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
            'Accept': 'text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        };
        let buffer, contentType, sourceUrl = url;
        try {
            const response = await axios.get(sourceUrl, { responseType: 'arraybuffer', headers: commonHeaders, validateStatus: s => s >= 200 && s < 300 });
            buffer = Buffer.from(response.data);
            contentType = response.headers['content-type'] || 'application/octet-stream';
            if (/text\/html/i.test(contentType)) {
                // Parse HTML for a PDF link
                const html = Buffer.from(response.data).toString('utf8');
                const pdfMatch = html.match(/href\s*=\s*"([^"]+\.pdf)"|href\s*=\s*'([^']+\.pdf)'/i);
                if (pdfMatch) {
                    const pdfHref = pdfMatch[1] || pdfMatch[2];
                    const resolvedUrl = new URL(pdfHref, sourceUrl).toString();
                    const pdfResp = await axios.get(resolvedUrl, { responseType: 'arraybuffer', headers: commonHeaders });
                    buffer = Buffer.from(pdfResp.data);
                    contentType = pdfResp.headers['content-type'] || 'application/pdf';
                    sourceUrl = resolvedUrl;
                } else {
                    throw new Error('No PDF link found on page');
                }
            }
        } catch (err) {
            // Fallback: fetch as text and extract first .pdf link
            try {
                const htmlResp = await axios.get(sourceUrl, { responseType: 'text', headers: commonHeaders });
                const html = typeof htmlResp.data === 'string' ? htmlResp.data : Buffer.from(htmlResp.data).toString('utf8');
                const pdfMatch = html.match(/href\s*=\s*"([^"]+\.pdf)"|href\s*=\s*'([^']+\.pdf)'/i);
                if (!pdfMatch) throw err;
                const pdfHref = pdfMatch[1] || pdfMatch[2];
                const resolvedUrl = new URL(pdfHref, sourceUrl).toString();
                const pdfResp = await axios.get(resolvedUrl, { responseType: 'arraybuffer', headers: commonHeaders });
                buffer = Buffer.from(pdfResp.data);
                contentType = pdfResp.headers['content-type'] || 'application/pdf';
                sourceUrl = resolvedUrl;
            } catch (_) {
                throw err;
            }
        }

        // Decide filename from resolved sourceUrl
        const resolved = new URL(sourceUrl);
        const pathName = resolved.pathname.split('/').filter(Boolean).pop() || 'guideline.pdf';
        const isPdf = /pdf/i.test(contentType) || /\.pdf$/i.test(pathName);
        const baseName = (filename && filename.trim()) || decodeURIComponent(pathName);
        const finalName = isPdf ? (baseName.endsWith('.pdf') ? baseName : `${baseName}.pdf`) : baseName;

        // Ensure guidance folder exists
        const folderExists = await checkFolderExists(githubFolder);
        if (!folderExists) {
            return res.status(400).json({ success: false, error: 'Target folder does not exist in the repository' });
        }

        // Upload to GitHub
        const filePath = `${githubFolder}/${encodeURIComponent(finalName)}`;
        let fileSha = await getFileSha(filePath);

        // Correct GitHub Contents API URL
        const putUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
        const body = {
            message: `Import guideline from URL: ${finalName}`,
            content: buffer.toString('base64'),
            branch: githubBranch,
            ...(fileSha ? { sha: fileSha } : {})
        };

        const putResp = await axios.put(putUrl, body, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });

        // Optionally update guidelines list
        try {
            await updateGuidelinesMasterList(finalName);
        } catch (_) {}

        // Optionally mark user preference included by URL
        if (markIncluded && db) {
            try {
                const baseCol = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
                const norm = normalizeUrl(url);
                const urlDocId = `inc-url-${sanitizeIdForDoc(norm)}`;
                await baseCol.doc(urlDocId).set({
                    type: 'included',
                    url,
                    normalisedUrl: norm,
                    addedAt: admin.firestore.FieldValue.serverTimestamp(),
                    addedBy: req.user.email || userId
                }, { merge: true });
            } catch (_) {}
        }

        res.json({ success: true, filename: finalName, downloadUrl: `https://github.com/${githubOwner}/${githubRepo}/raw/${githubBranch}/${githubFolder}/${encodeURIComponent(finalName)}` });
    } catch (error) {
        console.error('[IMPORT] Failed to import guideline:', {
            message: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint: Proxy fetch for viewing (PDF/files) inside iframe, limited to allowlist hosts
app.get('/proxyGuidelineView', async (req, res) => {
    try {
        const { url, id_token } = req.query;
        if (!url) return res.status(400).send('url required');
        if (!id_token) return res.status(401).send('auth required');

        // Verify Firebase ID token (so iframe doesn't need headers)
        try {
            await admin.auth().verifyIdToken(String(id_token));
        } catch (e) {
            return res.status(401).send('invalid token');
        }

        let parsed;
        try { parsed = new URL(String(url)); } catch { return res.status(400).send('invalid url'); }
        const allowedHosts = new Set(['www.rcog.org.uk', 'rcog.org.uk', 'www.nice.org.uk', 'nice.org.uk']);
        if (!allowedHosts.has(parsed.hostname)) return res.status(400).send('domain not allowed');

        const upstream = await axios.get(String(url), { responseType: 'arraybuffer' });
        const contentType = upstream.headers['content-type'] || 'application/pdf';

        // Remove frameguard for this response and allow our client to embed
        res.removeHeader('X-Frame-Options');
        res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://clerkyai.health");
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(Buffer.from(upstream.data));
    } catch (error) {
        console.error('[PROXY] Failed:', error.message);
        res.status(500).send('proxy error');
    }
});

// Endpoint: discover guidelines using AI
app.post('/discoverGuidelines', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        // Load existing guidelines from Firestore (not GitHub text file)
        let allGuidelines = [];
        try {
            allGuidelines = await getAllGuidelines();
        } catch (_) {
            allGuidelines = [];
        }
        const existingUrls = new Set();
        const existingCanonicalIds = new Set();
        for (const g of allGuidelines) {
            if (g.downloadUrl) existingUrls.add(normalizeUrl(g.downloadUrl));
            if (g.canonicalId) existingCanonicalIds.add(String(g.canonicalId).toLowerCase());
        }

        // Load user preferences from Firestore
        let excludedSourceUrls = [];
        let excludedCanonicalIds = [];
        if (db) {
            try {
                const colRef = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
                const snapshot = await colRef.get();
                snapshot.forEach(doc => {
                    const d = doc.data() || {};
                    if (d.type === 'excluded' && d.normalisedUrl) excludedSourceUrls.push(d.normalisedUrl);
                    if (d.type === 'excluded' && d.canonicalId) excludedCanonicalIds.push(String(d.canonicalId).toLowerCase());
                });
            } catch (_) {}
        }
        const excludedUrlSet = new Set(excludedSourceUrls.map(u => normalizeUrl(u)));

        const systemPrompt = `You are assisting an Obstetrics & Gynaecology clinician. Identify official guidance documents that would be useful for day-to-day clinical work in the UK. Consider:
- NICE guidance
- RCOG Green-top Guidelines
- RCOG Scientific Impact Papers (SIPs)
- RCOG Consent Advice
- RCOG Good Practice Papers

Rules:
- Return only items that have an official, publicly accessible download URL (preferably PDF) from authoritative domains (e.g., rcog.org.uk, nice.org.uk).
- Avoid duplicates, and avoid items already provided in the existing list.
- Output strictly valid JSON (array of objects). No commentary.
`;

        // Provide a compact summary of existing guidelines (titles and org if present) to reduce tokens
        const existingSummary = allGuidelines.slice(0, 400).map(g => {
            const parts = [];
            if (g.organisation) parts.push(g.organisation);
            if (g.series && g.number) parts.push(`${g.series} ${g.number}`);
            if (g.year) parts.push(String(g.year));
            const head = parts.length ? `[${parts.join(' ')}]` : '';
            return `${head} ${g.title || g.id || ''}`.trim();
        }).join('\n');

        const userPrompt = `Existing guidelines:\n${existingSummary}\n\nExcluded source URLs (normalised):\n${Array.from(excludedUrlSet).join('\n')}\n\nTask: Propose additional, currently available guidance items (NICE/RCOG/SIPs/Consent Advice/Good Practice Papers) that would be useful to a working O&G doctor but are not yet included or excluded. For each item, return an object with keys: title (string), organisation ("NICE"|"RCOG"), type (e.g., "Green-top Guideline"|"SIP"|"Consent Advice"|"Good Practice Paper"|"Guideline"), year (number or null), url (direct downloadable URL), notes (optional string). Return a single JSON array only.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResult = await routeToAI({ messages }, userId);
        if (!aiResult || !aiResult.content) {
            return res.status(500).json({ success: false, error: 'AI did not return content' });
        }

        // Attempt to extract JSON array from response
        let text = aiResult.content.trim();
        // Remove code fences if present
        text = text.replace(/^```json\s*|```$/g, '').trim();
        let suggestions;
        try {
            // Find first [ ... ]
            const start = text.indexOf('[');
            const end = text.lastIndexOf(']');
            const jsonStr = (start !== -1 && end !== -1) ? text.substring(start, end + 1) : text;
            suggestions = JSON.parse(jsonStr);
            if (!Array.isArray(suggestions)) throw new Error('Not an array');
        } catch (parseErr) {
            console.error('[DISCOVER] Failed to parse AI JSON:', parseErr.message);
            return res.status(500).json({ success: false, error: 'Failed to parse AI JSON' });
        }

        // Filter out suggestions with excluded URLs or already existing URLs, and dedupe
        const seen = new Set([...excludedUrlSet, ...existingUrls]);
        const filtered = [];
        for (const item of suggestions) {
            if (!item || !item.url || !item.title) continue;
            const norm = normalizeUrl(item.url);
            if (seen.has(norm)) continue;
            seen.add(norm);
            filtered.push({
                title: item.title,
                organisation: item.organisation || null,
                type: item.type || null,
                year: item.year || null,
                url: item.url,
                notes: item.notes || null
            });
        }

        // Validate and resolve URLs to direct PDFs where possible
        async function resolvePdfUrl(originalUrl) {
            try {
                const allowedHosts = new Set(['www.rcog.org.uk', 'rcog.org.uk', 'www.nice.org.uk', 'nice.org.uk']);
                const parsed = new URL(originalUrl);
                if (!allowedHosts.has(parsed.hostname)) return null;
                const commonHeaders = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                    'Accept': 'text/html,application/pdf,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                };
                // Try HEAD first to check content-type
                try {
                    const head = await axios.head(originalUrl, { headers: commonHeaders });
                    const ct = (head.headers['content-type'] || '').toLowerCase();
                    if (ct.includes('application/pdf') || /\.pdf(\?|$)/i.test(parsed.pathname)) {
                        return originalUrl;
                    }
                } catch (_) {}
                // GET and check
                const resp = await axios.get(originalUrl, { responseType: 'arraybuffer', headers: commonHeaders });
                const ct2 = (resp.headers['content-type'] || '').toLowerCase();
                if (ct2.includes('application/pdf')) return originalUrl;
                if (ct2.includes('text/html')) {
                    const html = Buffer.from(resp.data).toString('utf8');
                    const m = html.match(/href\s*=\s*"([^"]+\.pdf)"|href\s*=\s*'([^']+\.pdf)'/i);
                    if (m) {
                        const href = m[1] || m[2];
                        const resolved = new URL(href, originalUrl).toString();
                        return resolved;
                    }
                }
                return null;
            } catch (_) {
                return null;
            }
        }

        const withResolved = [];
        const unresolved = [];

        for (const item of filtered) {
            const resolvedUrl = await resolvePdfUrl(item.url);
            if (resolvedUrl) {
                withResolved.push({ ...item, url: resolvedUrl });
            } else {
                unresolved.push(item);
            }
        }

        // Attempt AI refinement for unresolved items
        async function refinePdfUrlWithAI(item) {
            try {
                const refineSystem = 'You are finding official UK clinical guidance direct PDF links.';
                const refineUser = `The proposed URL is not a direct PDF or is invalid. Provide a single direct downloadable PDF URL for this item, compliant with domain allowlist.\n\nTitle: ${item.title}\nOrganisation: ${item.organisation || ''}\nOriginal URL: ${item.url}\n\nRequirements:\n- Must be a direct, publicly accessible .pdf URL (Content-Type application/pdf)\n- Allowed domains only: rcog.org.uk, nice.org.uk\n- Return strictly JSON: {"url":"..."} with no commentary`;
                const messages2 = [
                    { role: 'system', content: refineSystem },
                    { role: 'user', content: refineUser }
                ];
                const aiRef = await routeToAI({ messages: messages2 }, userId);
                if (!aiRef || !aiRef.content) return null;
                let text2 = aiRef.content.trim().replace(/^```json\s*|```$/g, '').trim();
                let candidateUrl = null;
                try {
                    const parsed2 = JSON.parse(text2);
                    if (Array.isArray(parsed2) && parsed2.length > 0 && parsed2[0].url) {
                        candidateUrl = parsed2[0].url;
                    } else if (parsed2 && parsed2.url) {
                        candidateUrl = parsed2.url;
                    }
                } catch (_) {
                    const m = text2.match(/https?:[^\s'\"]+\.pdf/ig);
                    if (m && m.length) candidateUrl = m[0];
                }
                if (!candidateUrl) return null;
                const resolved = await resolvePdfUrl(candidateUrl);
                return resolved;
            } catch (_) { return null; }
        }

        for (const item of unresolved) {
            // Up to two refinement attempts
            let refined = await refinePdfUrlWithAI(item);
            if (!refined) refined = await refinePdfUrlWithAI(item);
            if (refined) {
                withResolved.push({ ...item, url: refined, notes: item.notes || 'resolved_via_refine' });
            }
        }

        // Log interaction (best-effort)
        try {
            await logAIInteraction(
                { prompt: userPrompt, system_prompt: systemPrompt },
                { success: true, response: withResolved.slice(0, 5) },
                'discoverGuidelines'
            );
        } catch (_) {}

        res.json({ success: true, suggestions: withResolved });
    } catch (error) {
        console.error('[ERROR] discoverGuidelines failed:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to update existing guidelines with auditable elements
app.post('/updateGuidelinesWithAuditableElements', authenticateUser, async (req, res) => {
  try {
    console.log('[DEBUG] updateGuidelinesWithAuditableElements endpoint called');
    
    if (!db) {
      return res.status(500).json({ 
        success: false, 
        error: 'Firestore not available' 
      });
    }

    // Get AI provider from request (default to DeepSeek if not specified)
    const { guidelineId, aiProvider = 'DeepSeek' } = req.body;
    console.log(`[DEBUG] Using AI provider: ${aiProvider} for guideline: ${guidelineId}`);
    
    // If specific guidelineId is provided, update only that one
    if (guidelineId) {
      try {
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
          return res.status(404).json({ 
            success: false, 
            error: 'Guideline not found' 
          });
        }
        
        const guideline = guidelineDoc.data();
        
        // Skip if already has auditable elements
        if (guideline.auditableElements && guideline.auditableElements.length > 0) {
          return res.json({ 
            success: true, 
            results: [{ 
              guidelineId, 
              success: true, 
              message: 'Already has auditable elements',
              count: guideline.auditableElements.length 
            }]
          });
        }
        
        // Extract auditable elements from content
        const content = guideline.content || guideline.condensed;
        if (!content) {
          return res.status(400).json({ 
            success: false, 
            error: 'No content available for extraction' 
          });
        }
        
        const auditableElements = await extractAuditableElements(content, aiProvider);
        
        // Update the guideline
        await guidelineRef.update({
          auditableElements: auditableElements,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log(`[DEBUG] Updated ${guidelineId} with ${auditableElements.length} auditable elements`);
        
        return res.json({ 
          success: true, 
          results: [{ 
            guidelineId, 
            success: true, 
            message: 'Updated with auditable elements',
            count: auditableElements.length 
          }]
        });
        
      } catch (error) {
        console.error(`[DEBUG] Error updating guideline ${guidelineId}:`, error);
        return res.status(500).json({ 
          success: false, 
          error: error.message 
        });
      }
    }
    
    // Otherwise, process all guidelines
    const guidelinesSnapshot = await db.collection('guidelines').get();
    const results = [];
    
    for (const doc of guidelinesSnapshot.docs) {
      try {
        const guideline = doc.data();
        const guidelineId = doc.id;
        
        // Skip if already has auditable elements
        if (guideline.auditableElements && guideline.auditableElements.length > 0) {
          results.push({ 
            guidelineId, 
            success: true, 
            message: 'Already has auditable elements',
            count: guideline.auditableElements.length 
          });
          continue;
        }
        
        // Extract auditable elements from content
        const content = guideline.content || guideline.condensed;
        if (!content) {
          results.push({ 
            guidelineId, 
            success: false, 
            message: 'No content available for extraction' 
          });
          continue;
        }
        
        const auditableElements = await extractAuditableElements(content, aiProvider);
        
        // Update the guideline
        await db.collection('guidelines').doc(guidelineId).update({
          auditableElements: auditableElements,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        results.push({ 
          guidelineId, 
          success: true, 
          message: 'Updated with auditable elements',
          count: auditableElements.length 
        });
        
        console.log(`[DEBUG] Updated ${guidelineId} with ${auditableElements.length} auditable elements`);
        
      } catch (error) {
        console.error(`[DEBUG] Error updating guideline ${doc.id}:`, error);
        results.push({ 
          guidelineId: doc.id, 
          success: false, 
          error: error.message 
        });
      }
    }
    
    res.json({ 
      success: true, 
      results,
      totalProcessed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });
    
  } catch (error) {
    console.error('[ERROR] Failed to update guidelines with auditable elements:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Endpoint to generate audit transcript for a guideline
app.post('/generateAuditTranscript', authenticateUser, async (req, res) => {
  try {
    console.log('[AUDIT-TRANSCRIPT] Generating audit transcript...');
    
    const { 
      guidelineId, 
      auditableElements, 
      auditScope = 'most_significant',
      aiProvider = 'DeepSeek' 
    } = req.body;
    
    if (!guidelineId || !auditableElements || !Array.isArray(auditableElements)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: guidelineId and auditableElements array'
      });
    }
    
    // Filter auditable elements based on scope
    let selectedElements = [];
    switch (auditScope) {
      case 'most_significant':
        selectedElements = auditableElements.filter(el => el.significance === 'high').slice(0, 1);
        break;
      case 'high_significance':
        selectedElements = auditableElements.filter(el => el.significance === 'high');
        break;
      case 'high_medium':
        selectedElements = auditableElements.filter(el => 
          el.significance === 'high' || el.significance === 'medium'
        );
        break;
      case 'all_elements':
        selectedElements = auditableElements;
        break;
      default:
        selectedElements = auditableElements.filter(el => el.significance === 'high').slice(0, 1);
    }
    
    if (selectedElements.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No auditable elements found for the selected scope'
      });
    }
    
    // Create a comprehensive prompt for generating the audit transcript
    const auditPrompt = `You are a clinical AI assistant tasked with generating a comprehensive fake clinical transcript for audit purposes.

GUIDELINE CONTEXT:
Guideline ID: ${guidelineId}
Number of auditable elements to cover: ${selectedElements.length}

AUDITABLE ELEMENTS TO COVER:
${selectedElements.map((element, index) => `
Element ${index + 1}:
- Name: ${element.name}
- Type: ${element.type}
- Significance: ${element.significance}
- Input Variables: ${element.inputVariables ? element.inputVariables.join(', ') : 'None'}
- Derived Advice: ${element.derivedAdvice}
- Element Details: ${element.element}
`).join('\n')}

REQUIREMENTS:
1. Create a realistic clinical scenario that covers ALL the auditable elements above
2. Include ALL the input variables mentioned in the elements
3. Ensure the scenario would trigger the derived advice from each element
4. Use proper medical terminology and British abbreviations
5. Follow SBAR format (Situation, Background, Assessment, Recommendation)
6. Make it clinically authentic with realistic patient demographics
7. Include relevant clinical observations and measurements
8. This is for audit testing purposes - entirely fictional

FORMAT:
SITUATION: [Demographics, presentation, key clinical issue]
BACKGROUND: [Relevant history, previous episodes, risk factors, medications]
ASSESSMENT: [Clinical findings, vital signs, test results, differential diagnosis]
RECOMMENDATION: [Management plan, monitoring, follow-up, further investigations]

Generate a comprehensive clinical transcript that would test all the auditable elements listed above.`;

    console.log('[AUDIT-TRANSCRIPT] Calling AI with audit prompt...');
    
    const aiResponse = await routeToAI({
      messages: [
        {
          role: 'system',
          content: 'You are a clinical AI assistant generating comprehensive audit transcripts for guideline compliance testing.'
        },
        {
          role: 'user',
          content: auditPrompt
        }
      ]
    }, req.user.uid, aiProvider);
    
    if (!aiResponse || !aiResponse.content) {
      throw new Error('Failed to generate audit transcript from AI');
    }
    
    const transcript = aiResponse.content;
    
    // Store the transcript in Firestore for audit purposes with enhanced labeling
    const auditRef = db.collection('auditTranscripts').doc();
    
    // Create detailed audit data with significance labeling
    const auditData = {
      guidelineId: guidelineId,
      transcript: transcript,
      auditableElements: selectedElements.map(element => ({
        ...element,
        significance: element.significance || 'medium', // Ensure significance is set
        testType: 'correct_script'
      })),
      auditScope: auditScope,
      aiProvider: aiProvider,
      generatedBy: req.user.uid,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'correct_script',
      significanceBreakdown: {
        high: selectedElements.filter(el => el.significance === 'high').length,
        medium: selectedElements.filter(el => el.significance === 'medium').length,
        low: selectedElements.filter(el => el.significance === 'low').length
      },
      totalElements: selectedElements.length,
      metadata: {
        guidelineTitle: selectedElements[0]?.guidelineTitle || guidelineId,
        auditPurpose: 'compliance_testing',
        version: '1.0'
      }
    };
    
    await auditRef.set(auditData);
    
    console.log('[AUDIT-TRANSCRIPT] Successfully generated and stored audit transcript:', {
      auditId: auditRef.id,
      guidelineId: guidelineId,
      elementsCovered: selectedElements.length,
      transcriptLength: transcript.length
    });
    
    res.json({
      success: true,
      auditId: auditRef.id,
      transcript: transcript,
      auditableElements: selectedElements,
      auditScope: auditScope,
      generated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AUDIT-TRANSCRIPT] Error generating audit transcript:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate audit transcript',
      details: error.message
    });
  }
});

// Endpoint to generate incorrect audit scripts
app.post('/generateIncorrectAuditScripts', authenticateUser, async (req, res) => {
  try {
    console.log('[AUDIT-INCORRECT] Generating incorrect audit scripts...');
    
    const { 
      auditId, 
      correctTranscript, 
      auditableElements,
      aiProvider = 'DeepSeek' 
    } = req.body;
    
    if (!auditId || !correctTranscript || !auditableElements || !Array.isArray(auditableElements)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: auditId, correctTranscript, and auditableElements array'
      });
    }
    
    const incorrectScripts = [];
    
    // Generate one incorrect script for each auditable element
    for (let i = 0; i < auditableElements.length; i++) {
      const element = auditableElements[i];
      
      // Create prompt for generating incorrect script
      const incorrectPrompt = `You are a clinical AI assistant generating an INCORRECT clinical transcript for audit testing purposes.

AUDITABLE ELEMENT TO MAKE INCORRECT:
- Name: ${element.name}
- Type: ${element.type}
- Significance: ${element.significance}
- Input Variables: ${element.inputVariables ? element.inputVariables.join(', ') : 'None'}
- Derived Advice: ${element.derivedAdvice}
- Element Details: ${element.element}

CORRECT TRANSCRIPT (for reference):
${correctTranscript}

REQUIREMENTS:
1. Create a transcript that is VERY SIMILAR to the correct one but with ONE KEY ERROR
2. The error should be related to the auditable element above
3. Either:
   - Omit a key variable that should trigger the advice
   - Provide incorrect advice that contradicts the guideline
   - Include contradictory information
4. Make the error subtle but detectable by an AI system
5. Keep the rest of the transcript realistic and medically sound
6. Use proper medical terminology and British abbreviations
7. Follow SBAR format
Generate an incorrect transcript that would fail audit testing for the specific auditable element mentioned above.`;

      console.log(`[AUDIT-INCORRECT] Generating incorrect script for element ${i + 1}/${auditableElements.length}...`);
      
      const aiResponse = await routeToAI({
        messages: [
          {
            role: 'system',
            content: 'You are a clinical AI assistant generating incorrect audit transcripts for guideline compliance testing.'
          },
          {
            role: 'user',
            content: incorrectPrompt
          }
        ]
      }, req.user.uid, aiProvider);
      
      if (aiResponse && aiResponse.content) {
        const incorrectScript = {
          elementIndex: i,
          elementName: element.name,
          elementType: element.type,
          significance: element.significance || 'medium',
          incorrectTranscript: aiResponse.content,
          errorType: 'omission_or_incorrect_advice',
          testType: 'incorrect_script',
          auditableElement: element.element,
          derivedAdvice: element.derivedAdvice,
          inputVariables: element.inputVariables || [],
          generatedAt: new Date().toISOString()
        };
        
        incorrectScripts.push(incorrectScript);
      }
    }
    
    // Store the incorrect scripts in Firestore with enhanced metadata
    const auditRef = db.collection('auditTranscripts').doc(auditId);
    
    // Calculate significance breakdown for incorrect scripts
    const incorrectSignificanceBreakdown = {
      high: incorrectScripts.filter(script => script.significance === 'high').length,
      medium: incorrectScripts.filter(script => script.significance === 'medium').length,
      low: incorrectScripts.filter(script => script.significance === 'low').length
    };
    
    await auditRef.update({
      incorrectScripts: incorrectScripts,
      incorrectSignificanceBreakdown: incorrectSignificanceBreakdown,
      totalIncorrectScripts: incorrectScripts.length,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      auditComplete: true
    });
    
    console.log('[AUDIT-INCORRECT] Successfully generated incorrect scripts:', {
      auditId: auditId,
      incorrectScriptsCount: incorrectScripts.length
    });
    
    res.json({
      success: true,
      auditId: auditId,
      incorrectScripts: incorrectScripts,
      generated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AUDIT-INCORRECT] Error generating incorrect audit scripts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate incorrect audit scripts',
      details: error.message
    });
  }
});
// ============================================================================
// GUIDELINE DISCOVERY API ENDPOINTS
// ============================================================================
const {
    runDiscoveryService,
    loadDiscoveryReport,
    saveApprovalDecisions,
    loadApprovalDecisions,
    processApprovedGuidelines
} = require('./scripts/guideline_discovery_api');

// Run guideline discovery (admin only)
app.post('/discoverMissingGuidelines', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        const { useHashCheck, priorityFilter, maxToCheck } = req.body;

        console.log('[DISCOVERY] Starting guideline discovery...');
        
        // Run the discovery service
        const result = await runDiscoveryService();
        
        // Load the generated report
        const report = await loadDiscoveryReport();
        
        res.json({
            success: true,
            message: 'Discovery completed successfully',
            report: report
        });
        
    } catch (error) {
        console.error('[DISCOVERY] Error:', error);
        res.status(500).json({
            error: 'Discovery failed',
            details: error.message
        });
    }
});

// Run hash-based verification for a single guideline
app.post('/verifyGuidelineHash', authenticateUser, async (req, res) => {
    try {
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        const { url, source, code } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL required' });
        }

        console.log(`[HASH_VERIFY] Checking guideline at: ${url}`);
        
        // Download PDF
        let pdfUrl = url;
        if (source === 'NICE' && code) {
            pdfUrl = `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf`;
        } else if (source === 'RCOG') {
            // RCOG guidelines often require member login - can't download directly
            console.log(`[HASH_VERIFY] RCOG guideline - manual download required`);
            return res.json({
                success: true,
                requiresManualDownload: true,
                message: 'RCOG guidelines often require member login',
                url: url
            });
        }
        
        const downloadResponse = await axios.get(pdfUrl, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            maxContentLength: 50 * 1024 * 1024,
            validateStatus: (status) => status >= 200 && status < 300
        });

        const buffer = Buffer.from(downloadResponse.data);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        
        console.log(`[HASH_VERIFY] Calculated hash: ${hash.substring(0, 16)}...`);
        
        // Check against database
        const query = db.collection('guidelines').where('fileHash', '==', hash);
        const snapshot = await query.get();
        
        const isDuplicate = !snapshot.empty;
        
        if (isDuplicate) {
            const existingDoc = snapshot.docs[0].data();
            console.log(`[HASH_VERIFY] Duplicate found: ${existingDoc.title || existingDoc.filename}`);
        } else {
            console.log(`[HASH_VERIFY] New guideline confirmed`);
        }
        
        res.json({
            success: true,
            hash,
            size: buffer.length,
            isDuplicate,
            existing: isDuplicate ? {
                title: snapshot.docs[0].data().title,
                filename: snapshot.docs[0].data().filename
            } : null
        });
        
    } catch (error) {
        console.error('[HASH_VERIFY] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get missing guidelines report (admin only)
app.get('/getMissingGuidelines', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        const report = await loadDiscoveryReport();
        const approvals = await loadApprovalDecisions();
        
        res.json({
            success: true,
            report: report,
            approvals: approvals
        });
        
    } catch (error) {
        console.error('[DISCOVERY] Error loading report:', error);
        res.status(500).json({
            error: 'Failed to load missing guidelines report',
            details: error.message
        });
    }
});

// Save approval decisions (admin only)
app.post('/saveGuidelineApprovals', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        const { approvals } = req.body;
        
        if (!approvals) {
            return res.status(400).json({ error: 'Approvals object required' });
        }

        const saved = await saveApprovalDecisions(approvals);
        
        res.json({
            success: true,
            message: 'Approvals saved successfully',
            approvals: saved
        });
        
    } catch (error) {
        console.error('[DISCOVERY] Error saving approvals:', error);
        res.status(500).json({
            error: 'Failed to save approvals',
            details: error.message
        });
    }
});

// Process approved guidelines (download and add to database)
app.post('/processApprovedGuidelines', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        const { guidelineIds } = req.body;
        
        if (!guidelineIds || !Array.isArray(guidelineIds)) {
            return res.status(400).json({ error: 'guidelineIds array required' });
        }

        const report = await loadDiscoveryReport();
        const results = await processApprovedGuidelines(guidelineIds, report);
        
        res.json({
            success: true,
            message: 'Processing completed',
            results: results
        });
        
    } catch (error) {
        console.error('[DISCOVERY] Error processing guidelines:', error);
        res.status(500).json({
            error: 'Failed to process guidelines',
            details: error.message
        });
    }
});

// ============================================================================
// END GUIDELINE DISCOVERY API
// ============================================================================

// Endpoint to get all guidelines
app.get('/getAllGuidelines', authenticateUser, async (req, res) => {
    try {
        // console.log('[DEBUG] getAllGuidelines endpoint called');
        
        // Check if Firestore is initialized
        if (!db) {
            console.log('[DEBUG] Firestore not initialized, returning empty guidelines with warning');
            return res.json({ 
                success: true, 
                guidelines: [],
                warning: 'Firestore not available - guidelines cannot be loaded',
                message: 'Application running in limited mode without guideline persistence'
            });
        }

        // console.log('[DEBUG] Calling getAllGuidelines function');
        const guidelines = await getAllGuidelines();
        // console.log('[DEBUG] getAllGuidelines returned:', guidelines.length, 'guidelines');
        
        // Check if we got empty results due to authentication issues
        if (guidelines.length === 0) {
            return res.json({ 
                success: true, 
                guidelines: [],
                warning: 'No guidelines found in database',
                message: 'This could be due to authentication issues or empty collections'
            });
        }
        
        res.json({ success: true, guidelines });
    } catch (error) {
        console.error('[ERROR] Failed to get all guidelines:', {
            message: error.message,
            stack: error.stack,
            firestoreAvailable: !!db,
            errorType: error.constructor.name
        });
        
        // Check if it's a crypto/authentication error
        if (error.message.includes('DECODER routines') || 
            error.message.includes('unsupported') ||
            error.message.includes('authentication') ||
            error.message.includes('private key')) {
            
            return res.json({ 
                success: true, 
                guidelines: [],
                warning: 'Database authentication error - running in limited mode',
                message: 'Guidelines cannot be loaded due to configuration issues',
                error: 'Authentication error'
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: 'Check server logs for more information',
            canRetry: true
        });
    }
});
// Add endpoint to delete all summaries from Firestore
app.post('/deleteAllSummaries', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        console.log('[DEBUG] Admin user authorized for deletion:', req.user.email);

        // Get all summaries
        const summariesSnapshot = await db.collection('guidelineSummaries').get();
        console.log(`[DEBUG] Found ${summariesSnapshot.size} summaries to delete`);

        // Delete in batches
        const batch = db.batch();
        summariesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        console.log('[DEBUG] Successfully deleted all summaries');
        res.json({ 
            success: true, 
            message: 'All summaries deleted successfully',
            count: summariesSnapshot.size
        });
    } catch (error) {
        console.error('[ERROR] Error deleting summaries:', error);
        res.status(500).json({ error: error.message });
    }
});
// Add endpoint to delete all guideline data from Firestore
app.post('/deleteAllGuidelineData', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        console.log('[DEBUG] Admin user authorized for deletion:', req.user.email);

        // Collections to delete
        const collections = [
            'guidelines',
            'guidelineSummaries',
            'guidelineKeywords',
            'guidelineCondensed'
        ];

        let totalDeleted = 0;
        const results = {};

        // Delete each collection
        for (const collection of collections) {
            const snapshot = await db.collection(collection).get();
            console.log(`[DEBUG] Found ${snapshot.size} documents in ${collection}`);
            
            // Delete in batches
            const batch = db.batch();
            snapshot.docs.forEach(doc => {
                batch.delete(doc.ref);
            });
            await batch.commit();
            
            results[collection] = snapshot.size;
            totalDeleted += snapshot.size;
            console.log(`[DEBUG] Successfully deleted ${snapshot.size} documents from ${collection}`);
        }

        console.log('[DEBUG] Successfully deleted all guideline data');
        res.json({ 
            success: true, 
            message: 'All guideline data deleted successfully',
            totalDeleted,
            results
        });
    } catch (error) {
        console.error('[ERROR] Error deleting guideline data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to cleanup deleted guidelines from Firestore
app.post('/cleanupDeletedGuidelines', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        console.log('[CLEANUP] Admin user authorized for cleanup:', req.user.email);

        // Get all guidelines from GitHub
        const githubGuidelines = await getGuidelinesList();
        console.log(`[CLEANUP] Found ${githubGuidelines.length} guidelines in GitHub`);

        // Get all guidelines from Firestore
        const firestoreSnapshot = await db.collection('guidelines').get();
        const firestoreGuidelines = [];
        firestoreSnapshot.forEach(doc => {
            const data = doc.data();
            firestoreGuidelines.push({
                id: doc.id,
                filename: data.filename || data.originalFilename || data.title,
                data: data
            });
        });
        console.log(`[CLEANUP] Found ${firestoreGuidelines.length} guidelines in Firestore`);

        // Find Firestore records that don't exist in GitHub
        const toDelete = [];
        for (const firestoreGuideline of firestoreGuidelines) {
            const filename = firestoreGuideline.filename;
            if (filename && !githubGuidelines.includes(filename)) {
                toDelete.push(firestoreGuideline);
                console.log(`[CLEANUP] Marking for deletion: ${filename} (ID: ${firestoreGuideline.id})`);
            }
        }

        console.log(`[CLEANUP] Found ${toDelete.length} stale records to delete`);

        // Delete stale records in batches
        let deletedCount = 0;
        const batchSize = 500; // Firestore batch limit
        
        for (let i = 0; i < toDelete.length; i += batchSize) {
            const batch = db.batch();
            const batchItems = toDelete.slice(i, i + batchSize);
            
            batchItems.forEach(item => {
                const docRef = db.collection('guidelines').doc(item.id);
                batch.delete(docRef);
            });
            
            await batch.commit();
            deletedCount += batchItems.length;
            console.log(`[CLEANUP] Deleted batch of ${batchItems.length} records (total: ${deletedCount})`);
        }

        const results = {
            githubCount: githubGuidelines.length,
            firestoreCount: firestoreGuidelines.length,
            deletedCount: deletedCount,
            deletedFiles: toDelete.map(item => ({
                id: item.id,
                filename: item.filename
            }))
        };

        console.log('[CLEANUP] Cleanup completed successfully');
        res.json({ 
            success: true, 
            message: `Cleanup completed: ${deletedCount} stale records removed`,
            results: results
        });

    } catch (error) {
        console.error('[CLEANUP] Error during cleanup:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during cleanup' 
        });
    }
});

// Endpoint to delete a single guideline
app.post('/deleteGuideline', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ 
                success: false, 
                error: 'Unauthorized. Admin access required.' 
            });
        }

        const { filename } = req.body;
        
        if (!filename) {
            return res.status(400).json({ 
                success: false, 
                error: 'Filename is required' 
            });
        }

        console.log(`[DELETE_GUIDELINE] Admin user ${req.user.email} requesting deletion of: ${filename}`);

        const deletionResults = {
            pdfDeleted: false,
            condensedDeleted: false,
            summaryDeleted: false,
            firestoreDeleted: false,
            listUpdated: false,
            errors: []
        };

        // 1. Delete PDF from guidance folder
        try {
            const pdfPath = `guidance/${encodeURIComponent(filename)}`;
            const pdfSha = await getFileSha(pdfPath);
            
            if (pdfSha) {
                await axios.delete(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${pdfPath}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${githubToken}`
                    },
                    data: {
                        message: `Delete guideline: ${filename}`,
                        sha: pdfSha,
                        branch: githubBranch
                    }
                });
                deletionResults.pdfDeleted = true;
                console.log(`[DELETE_GUIDELINE] Successfully deleted PDF: ${filename}`);
            } else {
                console.log(`[DELETE_GUIDELINE] PDF not found in GitHub: ${filename}`);
                deletionResults.errors.push('PDF file not found in repository');
            }
        } catch (error) {
            console.error(`[DELETE_GUIDELINE] Error deleting PDF:`, error.message);
            deletionResults.errors.push(`Failed to delete PDF: ${error.message}`);
        }

        // 2. Delete condensed text file
        try {
            const baseName = filename.replace(/\.pdf$/i, '');
            const condensedPath = `guidance/condensed/${encodeURIComponent(baseName + '.txt')}`;
            const condensedSha = await getFileSha(condensedPath);
            
            if (condensedSha) {
                await axios.delete(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${condensedPath}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${githubToken}`
                    },
                    data: {
                        message: `Delete condensed text for: ${filename}`,
                        sha: condensedSha,
                        branch: githubBranch
                    }
                });
                deletionResults.condensedDeleted = true;
                console.log(`[DELETE_GUIDELINE] Successfully deleted condensed file`);
            } else {
                console.log(`[DELETE_GUIDELINE] Condensed file not found`);
            }
        } catch (error) {
            console.error(`[DELETE_GUIDELINE] Error deleting condensed file:`, error.message);
            deletionResults.errors.push(`Failed to delete condensed file: ${error.message}`);
        }

        // 3. Delete summary text file
        try {
            const baseName = filename.replace(/\.pdf$/i, '');
            const summaryPath = `guidance/summary/${encodeURIComponent(baseName + '.txt')}`;
            const summarySha = await getFileSha(summaryPath);
            
            if (summarySha) {
                await axios.delete(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${summaryPath}`, {
                    headers: {
                        'Accept': 'application/vnd.github.v3+json',
                        'Authorization': `token ${githubToken}`
                    },
                    data: {
                        message: `Delete summary for: ${filename}`,
                        sha: summarySha,
                        branch: githubBranch
                    }
                });
                deletionResults.summaryDeleted = true;
                console.log(`[DELETE_GUIDELINE] Successfully deleted summary file`);
            } else {
                console.log(`[DELETE_GUIDELINE] Summary file not found`);
            }
        } catch (error) {
            console.error(`[DELETE_GUIDELINE] Error deleting summary file:`, error.message);
            deletionResults.errors.push(`Failed to delete summary file: ${error.message}`);
        }

        // 4. Delete from Firestore
        try {
            const cleanId = generateCleanDocId(filename);
            await db.collection('guidelines').doc(cleanId).delete();
            deletionResults.firestoreDeleted = true;
            console.log(`[DELETE_GUIDELINE] Successfully deleted from Firestore: ${cleanId}`);
        } catch (error) {
            console.error(`[DELETE_GUIDELINE] Error deleting from Firestore:`, error.message);
            deletionResults.errors.push(`Failed to delete from Firestore: ${error.message}`);
        }

        // 5. Update list_of_guidelines.txt
        try {
            const listPath = 'guidance/list_of_guidelines.txt';
            const listResponse = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${listPath}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });

            // Decode current content
            const currentContent = Buffer.from(listResponse.data.content, 'base64').toString();
            const guidelines = currentContent.split('\n').filter(line => line.trim() && line.trim() !== filename);
            
            // Update the file
            const updatedContent = guidelines.join('\n') + '\n';
            await axios.put(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${listPath}`, {
                message: `Remove ${filename} from guidelines list`,
                content: Buffer.from(updatedContent).toString('base64'),
                sha: listResponse.data.sha,
                branch: githubBranch
            }, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            deletionResults.listUpdated = true;
            console.log(`[DELETE_GUIDELINE] Successfully updated guidelines list`);
        } catch (error) {
            console.error(`[DELETE_GUIDELINE] Error updating guidelines list:`, error.message);
            deletionResults.errors.push(`Failed to update guidelines list: ${error.message}`);
        }

        // Determine overall success
        const success = deletionResults.pdfDeleted || deletionResults.firestoreDeleted;
        
        console.log(`[DELETE_GUIDELINE] Deletion completed for ${filename}:`, deletionResults);
        
        res.json({
            success: success,
            message: success ? `Successfully deleted guideline: ${filename}` : `Failed to delete guideline: ${filename}`,
            results: deletionResults
        });

    } catch (error) {
        console.error('[DELETE_GUIDELINE] Critical error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal server error during guideline deletion',
            details: error.message
        });
    }
});

// Endpoint to analyze note against a specific guideline
app.post('/analyzeNoteAgainstGuideline', authenticateUser, async (req, res) => {
    try {
        const { transcript, guideline: rawGuideline } = req.body;
        const userId = req.user.uid;
        
        if (!transcript) {
            return res.status(400).json({ success: false, error: 'Transcript is required' });
        }
        
        if (!rawGuideline) {
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }

        // Use the clean guideline ID directly (no decoding needed for slug-based IDs)
        const guideline = rawGuideline;
        console.log(`[DEBUG] Received clean guideline ID: "${guideline}"`);
        
        console.log(`[DEBUG] Fetching guideline data for ID: ${guideline}`);

        const prompts = require('./prompts.json');
        const promptConfig = prompts.analyzeClinicalNote; // or guidelineRecommendations
        if (!promptConfig) {
            return res.status(500).json({ success: false, error: 'Prompt configuration not found' });
        }

        // Fetch guideline data from database
        console.log(`[DEBUG] Fetching guideline data for ID: ${guideline}`);
        
        // Try to get guideline from multiple collections
        const [guidelineDoc, condensedDoc] = await Promise.all([
            db.collection('guidelines').doc(guideline).get(),
            db.collection('guidelineCondensed').doc(guideline).get()
        ]);

        if (!guidelineDoc.exists) {
            return res.status(404).json({ 
                success: false, 
                error: `Guideline not found with ID: ${guideline}` 
            });
        }

        const guidelineData = guidelineDoc.data();
        const condensedData = condensedDoc.exists ? condensedDoc.data() : null;
        
        // Prepare guideline content for AI
        const guidelineTitle = guidelineData.humanFriendlyTitle || guidelineData.title || guidelineData.fileName || guideline;
        const guidelineContent = condensedData?.condensed || guidelineData.content || guidelineData.condensed || 'No content available';
        
        console.log(`[DEBUG] Retrieved guideline: ${guidelineTitle}, content length: ${guidelineContent.length}`);

        // Format the messages for the AI with ID and title
        const messages = [
            { role: 'system', content: promptConfig.system_prompt },
            { role: 'user', content: promptConfig.prompt
                .replace('{{text}}', transcript)
                .replace('{{id}}', guideline)
                .replace('{{title}}', guidelineTitle)
                .replace('{{content}}', guidelineContent)
            }
        ];

        // Send to AI
        console.log(`[DEBUG] Sending to AI for guideline: ${guideline}`);
        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log(`[DEBUG] AI response received:`, {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error(`[DEBUG] Invalid AI response:`, aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Log the interaction
        console.log(`[DEBUG] Logging AI interaction...`);
        try {
            await logAIInteraction(
                {
                    prompt: messages[1].content, // The user message content
                    system_prompt: messages[0].content, // The system prompt
                    guideline_id: guideline,
                    guideline_title: guidelineTitle
                },
                {
                    success: true,
                    response: aiResponse.content,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage
                },
                'analyzeNoteAgainstGuideline'
            );
            console.log(`[DEBUG] AI interaction logged successfully`);
        } catch (logError) {
            console.error(`[DEBUG] Error logging AI interaction:`, {
                error: logError.message,
                stack: logError.stack
            });
            // Don't fail the request if logging fails
        }

        // Return the analysis
        console.log(`[DEBUG] Returning analysis result, content length: ${aiResponse.content.length}`);
        res.json({
            success: true,
            analysis: aiResponse.content
        });
    } catch (error) {
        console.error('[DEBUG] Error in /analyzeNoteAgainstGuideline:', {
            error: error.message,
            stack: error.stack,
            guideline: req.body?.guideline,
            transcript: req.body?.transcript ? `${req.body.transcript.substring(0, 100)}...` : 'undefined'
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Function to generate a consistent guideline ID
async function generateGuidelineId(organisation, yearProduced, title) {
  // Normalize organization name (remove spaces, special chars)
  const orgPrefix = (organisation || 'UNKNOWN')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .substring(0, 6);

  // Get year (use current year if not provided)
  const year = yearProduced || new Date().getFullYear();

  // Generate a unique suffix based on title
  const titleHash = title
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .substring(0, 4);

  // Get count of existing guidelines for this org/year
  const snapshot = await db.collection('guidelines')
    .where('organisation', '==', organisation)
    .where('yearProduced', '==', year)
    .count()
    .get();
  
  const count = snapshot.data().count;
  const uniqueNum = String(count + 1).padStart(3, '0');

  return `${orgPrefix}-${year}-${titleHash}-${uniqueNum}`;
}

// Function to check and migrate guideline IDs
async function checkAndMigrateGuidelineIds() {
  try {
    console.log('[DEBUG] Starting guideline ID check and migration process');
    
    // Get all guidelines
    const guidelinesSnapshot = await db.collection('guidelines').get();
    console.log(`[DEBUG] Found ${guidelinesSnapshot.size} guidelines to check`);

    const results = {
      total: guidelinesSnapshot.size,
      needsMigration: 0,
      alreadyMigrated: 0,
      errors: 0,
      details: []
    };

    const batch = db.batch();
    let hasChanges = false;

    // Process each guideline
    for (const doc of guidelinesSnapshot.docs) {
      const data = doc.data();
      const oldId = doc.id;
      
      try {
        // Check if guideline already has an ID
        if (data.guidelineId) {
          console.log(`[DEBUG] Guideline ${oldId} already has ID: ${data.guidelineId}`);
          results.alreadyMigrated++;
          results.details.push({
            oldId,
            existingId: data.guidelineId,
            status: 'already_migrated'
          });
          continue;
        }

        // Generate new ID
        const newId = await generateGuidelineId(
          data.organisation || 'UNKNOWN',
          data.yearProduced || new Date().getFullYear(),
          data.title || oldId
        );

        console.log(`[DEBUG] Migrating guideline: ${oldId} -> ${newId}`, {
          organisation: data.organisation,
          yearProduced: data.yearProduced,
          title: data.title
        });

        // Update main guideline document
        const guidelineRef = db.collection('guidelines').doc(oldId);
        batch.update(guidelineRef, { guidelineId: newId });

        // Update summary document
        const summaryRef = db.collection('guidelineSummaries').doc(oldId);
        batch.update(summaryRef, { guidelineId: newId });

        // Update keywords document
        const keywordsRef = db.collection('guidelineKeywords').doc(oldId);
        batch.update(keywordsRef, { guidelineId: newId });

        // Update condensed document
        const condensedRef = db.collection('guidelineCondensed').doc(oldId);
        batch.update(condensedRef, { guidelineId: newId });

        hasChanges = true;
        results.needsMigration++;
        results.details.push({
          oldId,
          newId,
          status: 'migrated'
        });
      } catch (error) {
        console.error(`[ERROR] Failed to migrate guideline ${oldId}:`, {
          error: error.message,
          stack: error.stack,
          data: {
            organisation: data.organisation,
            yearProduced: data.yearProduced,
            title: data.title
          }
        });
        results.errors++;
        results.details.push({
          oldId,
          error: error.message,
          status: 'error'
        });
      }
    }

    // Only commit if there are changes
    if (hasChanges) {
      console.log('[DEBUG] Committing changes to Firestore...');
      await batch.commit();
      console.log('[DEBUG] Changes committed successfully');
    } else {
      console.log('[DEBUG] No changes needed, skipping commit');
    }

    console.log('[DEBUG] Migration process completed', results);
    return results;
  } catch (error) {
    console.error('[ERROR] Error in checkAndMigrateGuidelineIds:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Add endpoint to manually trigger migration
app.post('/migrateGuidelineIds', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    console.log('[DEBUG] Admin user authorized for migration:', req.user.email);
    const results = await checkAndMigrateGuidelineIds();
    res.json({ success: true, results });
  } catch (error) {
    console.error('[ERROR] Error in migrateGuidelineIds endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Modify getAllGuidelines to check for IDs during load
async function getAllGuidelines() {
  try {
    // console.log('[DEBUG] getAllGuidelines function called');
    
    // Check if database is available
    if (!db) {
      console.log('[DEBUG] Firestore database not available, returning empty guidelines');
      return [];
    }

    // Check and migrate guideline IDs if needed
    console.log('[DEBUG] Checking guideline IDs...');
    await checkAndMigrateGuidelineIds();

    // Check and migrate null metadata if needed
    console.log('[DEBUG] Checking for null metadata...');
    await migrateNullMetadata();

    console.log('[DEBUG] Fetching guidelines from single collection (post-migration)');
    
    // Add timeout and better error handling for Firestore queries
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firestore query timeout')), 10000)
    );

    // Simplified: only fetch from guidelines collection since data is now consolidated
    const guidelines = await Promise.race([
      db.collection('guidelines').get(),
      timeout
    ]);

    console.log('[DEBUG] Guidelines collection size:', guidelines.size);

    const result = [];
    
    // Also fetch condensed data from separate collection to ensure completeness
    const condensedCollection = await db.collection('condensed').get();
    const condensedMap = new Map();
    condensedCollection.forEach(doc => {
      condensedMap.set(doc.id, doc.data().condensed);
    });
    
    // Process guidelines - merge data from all sources
    guidelines.forEach(doc => {
      const data = doc.data();
      const condensedFromCollection = condensedMap.get(doc.id);
      
      console.log(`[DEBUG] Processing guideline: ${doc.id}`, {
        hasGuidelineId: !!data.guidelineId,
        guidelineId: data.guidelineId,
        hasContent: !!data.content,
        hasSummary: !!data.summary,
        hasKeywords: !!data.keywords,
        hasCondensed: !!data.condensed,
        hasCondensedFromCollection: !!condensedFromCollection
      });
      
      result.push({
        ...data,
        id: doc.id,
        condensed: data.condensed || condensedFromCollection || null // Prefer document field, fallback to collection
      });
    });
    console.log('[DEBUG] Returning', result.length, 'guidelines');
    return result;
  } catch (error) {
    console.error('[ERROR] Error in getAllGuidelines function:', {
      message: error.message,
      stack: error.stack,
      errorType: error.constructor.name,
      firestoreAvailable: !!db
    });
    
    // If it's a crypto/auth error, return empty array to allow app to function
    if (error.message.includes('DECODER routines') || 
        error.message.includes('timeout')) {
      console.log('[DEBUG] Returning empty guidelines due to authentication/connectivity issues');
      return [];
    }
    
    throw error;
  }
}

app.put('/guideline/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    // Generate new docId if we have all required fields
    if (updates.organisation && updates.yearProduced && updates.title) {
      updates.docId = await generateDocId(
        updates.organisation,
        updates.yearProduced,
        updates.title
      );
      console.log(`[DEBUG] Generated new docId for ${id}:`, updates.docId);
    }
    
    const guidelineRef = db.collection('guidelines').doc(id);
    await guidelineRef.update({
      ...updates,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const doc = await guidelineRef.get();
    const data = doc.data();
    
    res.json({
      id: doc.id,
      hasDocId: !!data.docId,
      docId: data.docId,
      ...data
    });
  } catch (error) {
    console.error('[ERROR] Error in updateGuideline endpoint:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update the guideline endpoint response
app.get('/guideline/:id', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const guidelineData = await getGuideline(id);
        
        if (!guidelineData) {
            return res.status(404).json({ error: 'Guideline not found' });
        }

        res.json({
            id: guidelineData.id,
            ...guidelineData
        });
    } catch (error) {
        console.error('[ERROR] Error in /guideline/:id endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the updateGuideline endpoint
app.put('/guideline/:id', authenticateUser, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Generate new docId if we have all required fields
        if (updates.organisation && updates.yearProduced && updates.title) {
            updates.docId = await generateDocId(
                updates.organisation,
                updates.yearProduced,
                updates.title
            );
            console.log(`[DEBUG] Generated new docId for ${id}:`, updates.docId);
        }
        
        const guidelineRef = db.collection('guidelines').doc(id);
        await guidelineRef.update({
            ...updates,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        const doc = await guidelineRef.get();
        const data = doc.data();
        
        res.json({
            id: doc.id,
            hasDocId: !!data.docId,
            docId: data.docId,
            ...data
        });
    } catch (error) {
        console.error('[ERROR] Error in updateGuideline endpoint:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update getAllGuidelines to use document IDs
async function getAllGuidelines() {
    try {
        // console.log('[DEBUG] getAllGuidelines function called');
        
        if (!db) {
            console.log('[DEBUG] Firestore database not available, returning empty guidelines');
            return [];
        }

        console.log('[DEBUG] Fetching guidelines collections from Firestore');
        
        const timeout = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Firestore query timeout')), 10000)
        );

        const fetchCollections = async () => {
            return await Promise.all([
                db.collection('guidelines').get(),
                db.collection('summaries').get(),
                db.collection('keywords').get(),
                db.collection('condensed').get()
            ]);
        };

        const [guidelines, summaries, keywords, condensed] = await Promise.race([
            fetchCollections(),
            timeout
        ]);

        // console.log('[DEBUG] Collection sizes:', {
        //     guidelines: guidelines.size,
        //     summaries: summaries.size,
        //     keywords: keywords.size,
        //     condensed: condensed.size
        // });

        const guidelineMap = new Map();
        
        // Process main guidelines
        guidelines.forEach(doc => {
            const data = doc.data();
            
            // Generate human_friendly_name if missing
            let humanFriendlyName = data.human_friendly_name || data.humanFriendlyName;
            if (!humanFriendlyName && data.title) {
                humanFriendlyName = cleanHumanFriendlyName(data.title);
            }
            
            guidelineMap.set(doc.id, {
                ...data,
                id: doc.id,
                human_friendly_name: humanFriendlyName
            });
        });

        // Process summaries
        summaries.forEach(doc => {
            const data = doc.data();
            const guideline = guidelineMap.get(doc.id);
            if (guideline) {
                guideline.summary = data.summary;
            }
        });

        // Process keywords
        keywords.forEach(doc => {
            const data = doc.data();
            const guideline = guidelineMap.get(doc.id);
            if (guideline) {
                guideline.keywords = data.keywords;
            }
        });

        // Process condensed versions
        condensed.forEach(doc => {
            const data = doc.data();
            const guideline = guidelineMap.get(doc.id);
            if (guideline) {
                guideline.condensed = data.condensed;
            }
        });

        return Array.from(guidelineMap.values());
    } catch (error) {
        console.error('[ERROR] Error in getAllGuidelines:', error);
        return [];
    }
}
// Dynamic Advice API endpoint - converts analysis into interactive suggestions
app.post('/dynamicAdvice', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] dynamicAdvice endpoint called');
        const { transcript, analysis, guidelineId, guidelineTitle } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!transcript) {
            console.log('[DEBUG] dynamicAdvice: Missing transcript');
            return res.status(400).json({ success: false, error: 'Transcript is required' });
        }
        
        if (!analysis) {
            console.log('[DEBUG] dynamicAdvice: Missing analysis');
            return res.status(400).json({ success: false, error: 'Analysis is required' });
        }

        console.log('[DEBUG] dynamicAdvice request data:', {
            userId,
            transcriptLength: transcript.length,
            analysisLength: analysis.length,
            guidelineId,
            guidelineTitle
        });

        // Create AI prompt to convert analysis into structured suggestions
        const systemPrompt = `You are a medical AI assistant that converts clinical guideline analysis into structured, actionable suggestions. 

Your task is to analyze the provided guideline analysis and extract specific, actionable suggestions that can be presented to the user for acceptance, rejection, or modification.

CRITICAL CLINICAL REASONING REQUIREMENTS:
- You must first understand the specific clinical scenario and current diagnosis from the transcript
- Carefully assess whether each potential recommendation is APPROPRIATE and INDICATED for this specific case
- Apply the fundamental principle: "Will this investigation or intervention change management or improve patient care in this specific scenario?"
- Consider the clinical context: is this an acute emergency, established diagnosis, or uncertain diagnostic situation?
- Distinguish between situations where additional testing is needed vs. where the diagnosis is already established
- Only recommend interventions that would genuinely improve patient care in THIS specific scenario

GENERAL CLINICAL APPROPRIATENESS PRINCIPLES:
- Do NOT suggest diagnostic investigations when the diagnosis is already established through adequate clinical and/or imaging findings
- Do NOT recommend interventions that conflict with the current evidence-based management plan
- Do NOT suggest serial monitoring of biomarkers when the clinical picture and imaging provide sufficient diagnostic certainty
- Consider whether additional investigations would actually change the management approach
- Evaluate the timing: is this the appropriate point in the clinical course for this intervention?
- Apply cost-benefit analysis: does the potential benefit justify the intervention in this specific case?

For each suggestion you identify, return ONLY a valid JSON object with the following structure:
{
  "suggestions": [
    {
      "id": "1",
      "originalText": "text from transcript that needs changing OR description of missing element",
      "suggestedText": "proposed replacement text",
      "context": "detailed explanation of why this change is suggested, including relevant quoted text from the guideline in quotation marks, and confirmation that this recommendation is appropriate for the specific clinical scenario",
      "category": "addition|modification|deletion|formatting",
      "priority": "high|medium|low",
      "guidelineReference": "specific guideline section or rule"
    }
  ]
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY the JSON object - no markdown code blocks, no explanatory text
- Do not wrap the JSON in \`\`\`json or \`\`\` blocks
- Start your response directly with { and end with }
- Use sequential numeric IDs starting from "1"
- Ensure all JSON is properly formatted and valid

Important guidelines for originalText field:
- For MODIFICATIONS: Use the exact text from the transcript that needs to be changed
- For ADDITIONS (missing elements): Use descriptive text like "Missing: cervical length screening documentation" or "Gap: no discussion of antenatal corticosteroids"
- DO NOT use phrases like "no additional cervical length screening ordered" unless those exact words appear in the transcript
- For missing elements, be clear that you're identifying an absence, not quoting existing text
Important guidelines for context field:
- Provide detailed explanations including WHY the change is needed AND why it's appropriate for this specific case
- Include specific quoted text from the guideline using quotation marks (e.g., "According to the guideline: 'All women should receive screening for...'")
- Reference specific guideline recommendations or requirements
- Explain the clinical rationale behind the suggestion
- EXPLICITLY state why this recommendation is indicated in this particular clinical scenario
- Make the context informative and educational

Other important guidelines:
- Only suggest changes that are explicitly supported by the guideline analysis AND clinically appropriate for the specific scenario
- Make suggestions specific and actionable
- For modifications, ensure original text selections are precise and findable in the transcript
- Prioritize suggestions based on clinical importance and appropriateness
- If no clinically appropriate suggestions can be made, return {"suggestions": []}
- When in doubt about appropriateness, err on the side of NOT making the suggestion`;

        const userPrompt = `Original Transcript:
${transcript}
Guideline Analysis:
${analysis}
Guideline: ${guidelineTitle || guidelineId || 'Unknown'}
Please extract actionable suggestions from this analysis and format them as specified. For each suggestion, include detailed context with relevant quoted text from the guideline to help the user understand the reasoning behind the recommendation.`;

        console.log('[DEBUG] dynamicAdvice: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log('[DEBUG] dynamicAdvice: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] dynamicAdvice: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Parse AI response
        let suggestions = [];
        try {
            // First, try to parse the response directly as JSON
            const parsedResponse = JSON.parse(aiResponse.content);
            suggestions = parsedResponse.suggestions || [];
            console.log('[DEBUG] dynamicAdvice: Parsed suggestions directly:', {
                count: suggestions.length,
                categories: suggestions.map(s => s.category)
            });
        } catch (parseError) {
            console.log('[DEBUG] dynamicAdvice: Direct JSON parse failed, trying to extract from markdown:', {
                error: parseError.message,
                rawContentPreview: aiResponse.content.substring(0, 200)
            });
            
            // Try to extract JSON from markdown code blocks
            try {
                let jsonContent = aiResponse.content;
                
                // Remove markdown code blocks if present
                const jsonMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
                if (jsonMatch) {
                    jsonContent = jsonMatch[1];
                    console.log('[DEBUG] dynamicAdvice: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        console.log('[DEBUG] dynamicAdvice: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                console.log('[DEBUG] dynamicAdvice: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                const parsedResponse = JSON.parse(jsonContent);
                suggestions = parsedResponse.suggestions || [];
                
                console.log('[DEBUG] dynamicAdvice: Successfully parsed extracted JSON:', {
                    count: suggestions.length,
                    categories: suggestions.map(s => s.category)
                });
                
            } catch (extractError) {
                console.error('[DEBUG] dynamicAdvice: Failed to extract and parse JSON from markdown:', {
                    error: extractError.message,
                    rawContent: aiResponse.content.substring(0, 500)
                });
                
                // Final fallback: create a single suggestion with the raw content
                suggestions = [{
                    id: 'fallback_1',
                    originalText: '',
                    suggestedText: 'Unable to parse AI response properly. Please try again.',
                    context: 'There was an issue processing the AI response. The raw response has been logged for debugging.',
                    category: 'addition',
                    priority: 'medium',
                    guidelineReference: guidelineTitle || guidelineId || 'Guideline analysis'
                }];
                console.log('[DEBUG] dynamicAdvice: Using final fallback suggestion format');
                
                // Log the full raw content for debugging
                console.error('[DEBUG] dynamicAdvice: Full raw AI response for debugging:', aiResponse.content);
            }
        }

        // Add unique session ID for tracking user decisions
        const sessionId = `advice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store suggestions in database for later retrieval
        try {
            const suggestionsRef = db.collection('dynamicAdvice').doc(sessionId);
            await suggestionsRef.set({
                userId,
                sessionId,
                transcript,
                analysis,
                guidelineId,
                guidelineTitle,
                suggestions,
                decisions: {}, // Will store user decisions
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            });
            console.log('[DEBUG] dynamicAdvice: Stored suggestions in database with sessionId:', sessionId);
        } catch (dbError) {
            console.error('[DEBUG] dynamicAdvice: Database storage error:', dbError.message);
            // Continue without failing the request
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    transcript_length: transcript.length,
                    analysis_length: analysis.length,
                    guideline_id: guidelineId,
                    guideline_title: guidelineTitle
                },
                {
                    success: true,
                    response: aiResponse.content,
                    suggestions_count: suggestions.length,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage,
                    session_id: sessionId
                },
                'dynamicAdvice'
            );
            console.log('[DEBUG] dynamicAdvice: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] dynamicAdvice: Error logging AI interaction:', logError.message);
        }

        console.log('[DEBUG] dynamicAdvice: Returning response', {
            sessionId,
            suggestionsCount: suggestions.length,
            success: true
        });

        res.json({
            success: true,
            sessionId,
            suggestions,
            guidelineId,
            guidelineTitle
        });

    } catch (error) {
        console.error('[DEBUG] dynamicAdvice: Error in endpoint:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.uid,
            requestBody: {
                transcriptLength: req.body?.transcript?.length,
                analysisLength: req.body?.analysis?.length,
                guidelineId: req.body?.guidelineId
            }
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Multi-Guideline Dynamic Advice API endpoint - processes multiple guidelines and combines suggestions
app.post('/multiGuidelineDynamicAdvice', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] multiGuidelineDynamicAdvice endpoint called');
        const { transcript, guidelineAnalyses } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!transcript) {
            console.log('[DEBUG] multiGuidelineDynamicAdvice: Missing transcript');
            return res.status(400).json({ success: false, error: 'Transcript is required' });
        }
        
        if (!guidelineAnalyses || !Array.isArray(guidelineAnalyses) || guidelineAnalyses.length === 0) {
            console.log('[DEBUG] multiGuidelineDynamicAdvice: Missing or invalid guideline analyses');
            return res.status(400).json({ success: false, error: 'Guideline analyses array is required' });
        }

        console.log('[DEBUG] multiGuidelineDynamicAdvice request data:', {
            userId,
            transcriptLength: transcript.length,
            guidelinesCount: guidelineAnalyses.length,
            guidelines: guidelineAnalyses.map(g => ({ id: g.guidelineId, title: g.guidelineTitle }))
        });

        // Create AI prompt to convert multiple guideline analyses into combined structured suggestions
        const systemPrompt = `You are a medical AI assistant that converts multiple clinical guideline analyses into structured, actionable suggestions. You will receive analyses from multiple guidelines and must create a comprehensive set of suggestions that prioritizes the most important recommendations while avoiding redundancy.

Your task is to analyze the provided guideline analyses and extract specific, actionable suggestions that can be presented to the user for acceptance, rejection, or modification.

CRITICAL CLINICAL REASONING REQUIREMENTS:
- You must first understand the specific clinical scenario and current diagnosis from the transcript
- Carefully assess whether each potential recommendation is APPROPRIATE and INDICATED for this specific case
- Apply the fundamental principle: "Will this investigation or intervention change management or improve patient care in this specific scenario?"
- Consider the clinical context: is this an acute emergency, established diagnosis, or uncertain diagnostic situation?
- Distinguish between situations where additional testing is needed vs. where the diagnosis is already established
- Only recommend interventions that would genuinely improve patient care in THIS specific scenario

MULTI-GUIDELINE PROCESSING PRINCIPLES:
- Combine and consolidate similar recommendations from different guidelines
- Prioritize recommendations that appear in multiple guidelines or are emphasized as critical
- Avoid duplicate suggestions - if multiple guidelines suggest the same thing, create one combined suggestion referencing all relevant guidelines
- When guidelines conflict, clearly note this and explain the rationale for your recommendation
- Organize suggestions by clinical priority and relevance to the case

GENERAL CLINICAL APPROPRIATENESS PRINCIPLES:
- Do NOT suggest diagnostic investigations when the diagnosis is already established through adequate clinical and/or imaging findings
- Do NOT recommend interventions that conflict with the current evidence-based management plan
- Do NOT suggest serial monitoring of biomarkers when the clinical picture and imaging provide sufficient diagnostic certainty
- Consider whether additional investigations would actually change the management approach
- Evaluate the timing: is this the appropriate point in the clinical course for this intervention?
- Apply cost-benefit analysis: does the potential benefit justify the intervention in this specific case?

For each suggestion you identify, return ONLY a valid JSON object with the following structure:
{
  "combinedSuggestions": [
    {
      "id": "1",
      "originalText": "text from transcript that needs changing OR description of missing element",
      "suggestedText": "proposed replacement text",
      "context": "detailed explanation of why this change is suggested, including relevant quoted text from the guidelines in quotation marks, and confirmation that this recommendation is appropriate for the specific clinical scenario",
      "category": "addition|modification|deletion|formatting",
      "priority": "high|medium|low",
      "sourceGuidelines": ["Guideline 1 Name", "Guideline 2 Name"],
      "consolidatedFrom": "explanation of how this suggestion combines recommendations from multiple guidelines, if applicable"
    }
  ],
  "guidelinesSummary": [
    {
      "guidelineTitle": "Guideline Name",
      "keyRecommendations": "summary of the most important recommendations from this guideline for this case",
      "relevanceScore": "high|medium|low"
    }
  ]
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY the JSON object - no markdown code blocks, no explanatory text
- Do not wrap the JSON in \`\`\`json or \`\`\` blocks
- Start your response directly with { and end with }
- Use sequential numeric IDs starting from "1"
- Ensure all JSON is properly formatted and valid

Important guidelines for consolidation:
- If multiple guidelines recommend the same intervention, create ONE suggestion that references all relevant guidelines
- Prioritize suggestions that are consistently recommended across multiple guidelines
- When guidelines provide different specifics for the same general recommendation, include the most comprehensive/specific version
- If guidelines conflict, choose the most appropriate recommendation for this specific case and explain why

Important guidelines for context field:
- Provide detailed explanations including WHY the change is needed AND why it's appropriate for this specific case
- Include specific quoted text from the relevant guidelines using quotation marks
- Reference which specific guidelines support this recommendation
- Explain the clinical rationale behind the suggestion
- EXPLICITLY state why this recommendation is indicated in this particular clinical scenario
- Make the context informative and educational`;

        // Prepare the combined analyses text
        let combinedAnalysesText = '';
        guidelineAnalyses.forEach((analysis, index) => {
            combinedAnalysesText += `\n\n=== GUIDELINE ${index + 1}: ${analysis.guidelineTitle || analysis.guidelineId} ===\n`;
            combinedAnalysesText += analysis.analysis;
        });

        const userPrompt = `Original Transcript:
${transcript}

Combined Guideline Analyses:
${combinedAnalysesText}

Please extract and consolidate actionable suggestions from these multiple guideline analyses. Create combined suggestions when multiple guidelines recommend similar interventions, and prioritize suggestions based on clinical importance and consensus across guidelines. For each suggestion, include detailed context with relevant quoted text from the supporting guidelines.`;

        console.log('[DEBUG] multiGuidelineDynamicAdvice: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            guidelinesCount: guidelineAnalyses.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log('[DEBUG] multiGuidelineDynamicAdvice: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] multiGuidelineDynamicAdvice: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Parse AI response
        let combinedSuggestions = [];
        let guidelinesSummary = [];
        try {
            // First, try to parse the response directly as JSON
            const parsedResponse = JSON.parse(aiResponse.content);
            combinedSuggestions = parsedResponse.combinedSuggestions || [];
            guidelinesSummary = parsedResponse.guidelinesSummary || [];
            
            console.log('[DEBUG] multiGuidelineDynamicAdvice: Parsed suggestions directly:', {
                suggestionsCount: combinedSuggestions.length,
                guidelinesSummaryCount: guidelinesSummary.length
            });
        } catch (parseError) {
            console.log('[DEBUG] multiGuidelineDynamicAdvice: Direct JSON parse failed, trying to extract from markdown:', {
                error: parseError.message,
                rawContentPreview: aiResponse.content.substring(0, 200)
            });
            
            // Try to extract JSON from markdown code blocks
            try {
                let jsonContent = aiResponse.content;
                
                // Remove markdown code blocks if present
                const jsonMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
                if (jsonMatch) {
                    jsonContent = jsonMatch[1];
                    console.log('[DEBUG] multiGuidelineDynamicAdvice: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        console.log('[DEBUG] multiGuidelineDynamicAdvice: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                console.log('[DEBUG] multiGuidelineDynamicAdvice: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                const parsedResponse = JSON.parse(jsonContent);
                combinedSuggestions = parsedResponse.combinedSuggestions || [];
                guidelinesSummary = parsedResponse.guidelinesSummary || [];
                
                console.log('[DEBUG] multiGuidelineDynamicAdvice: Successfully parsed extracted JSON:', {
                    suggestionsCount: combinedSuggestions.length,
                    guidelinesSummaryCount: guidelinesSummary.length
                });
                
            } catch (extractError) {
                console.error('[DEBUG] multiGuidelineDynamicAdvice: Failed to extract and parse JSON from markdown:', {
                    error: extractError.message,
                    rawContent: aiResponse.content.substring(0, 500)
                });
                
                // Final fallback: create a single suggestion with the raw content
                combinedSuggestions = [{
                    id: 'fallback_1',
                    originalText: '',
                    suggestedText: 'Unable to parse AI response properly. Please try again.',
                    context: 'There was an issue processing the AI response. The raw response has been logged for debugging.',
                    category: 'addition',
                    priority: 'medium',
                    sourceGuidelines: guidelineAnalyses.map(g => g.guidelineTitle || g.guidelineId),
                    consolidatedFrom: 'Error processing multi-guideline analysis'
                }];
                
                guidelinesSummary = guidelineAnalyses.map(g => ({
                    guidelineTitle: g.guidelineTitle || g.guidelineId,
                    keyRecommendations: 'Unable to process due to AI response parsing error',
                    relevanceScore: 'unknown'
                }));
                
                console.log('[DEBUG] multiGuidelineDynamicAdvice: Using final fallback suggestion format');
                
                // Log the full raw content for debugging
                console.error('[DEBUG] multiGuidelineDynamicAdvice: Full raw AI response for debugging:', aiResponse.content);
            }
        }

        // Add source guideline information to each suggestion
        combinedSuggestions.forEach((suggestion, index) => {
            if (!suggestion.sourceGuidelines) {
                suggestion.sourceGuidelines = [guidelineAnalyses[0]?.guidelineTitle || 'Multi-guideline analysis'];
            }
            if (!suggestion.id) {
                suggestion.id = `combined_${index + 1}`;
            }
        });

        // Add unique session ID for tracking user decisions
        const sessionId = `multi_advice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store suggestions in database for later retrieval
        try {
            const suggestionsRef = db.collection('dynamicAdvice').doc(sessionId);
            await suggestionsRef.set({
                userId,
                sessionId,
                transcript,
                guidelineAnalyses,
                combinedSuggestions,
                guidelinesSummary,
                decisions: {}, // Will store user decisions
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending',
                type: 'multi-guideline'
            });
            console.log('[DEBUG] multiGuidelineDynamicAdvice: Stored combined suggestions in database with sessionId:', sessionId);
        } catch (dbError) {
            console.error('[DEBUG] multiGuidelineDynamicAdvice: Database storage error:', dbError.message);
            // Continue without failing the request
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    transcript_length: transcript.length,
                    guidelines_count: guidelineAnalyses.length,
                    guideline_titles: guidelineAnalyses.map(g => g.guidelineTitle || g.guidelineId)
                },
                {
                    success: true,
                    response: aiResponse.content,
                    suggestions_count: combinedSuggestions.length,
                    guidelines_summary_count: guidelinesSummary.length,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage,
                    session_id: sessionId
                },
                'multiGuidelineDynamicAdvice'
            );
            console.log('[DEBUG] multiGuidelineDynamicAdvice: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] multiGuidelineDynamicAdvice: Error logging AI interaction:', logError.message);
        }

        console.log('[DEBUG] multiGuidelineDynamicAdvice: Returning response', {
            sessionId,
            combinedSuggestionsCount: combinedSuggestions.length,
            guidelinesSummaryCount: guidelinesSummary.length,
            success: true
        });

        res.json({
            success: true,
            sessionId,
            combinedSuggestions,
            guidelinesSummary,
            guidelinesAnalyzed: guidelineAnalyses.length
        });

    } catch (error) {
        console.error('[DEBUG] multiGuidelineDynamicAdvice: Error in endpoint:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.uid,
            requestBody: {
                transcriptLength: req.body?.transcript?.length,
                guidelinesCount: req.body?.guidelineAnalyses?.length
            }
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Apply Dynamic Advice API endpoint - applies user decisions to transcript
app.post('/applyDynamicAdvice', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] applyDynamicAdvice endpoint called');
        const { sessionId, decisions } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!sessionId) {
            console.log('[DEBUG] applyDynamicAdvice: Missing sessionId');
            return res.status(400).json({ success: false, error: 'Session ID is required' });
        }
        
        if (!decisions || typeof decisions !== 'object') {
            console.log('[DEBUG] applyDynamicAdvice: Invalid decisions format');
            return res.status(400).json({ success: false, error: 'Decisions object is required' });
        }

        console.log('[DEBUG] applyDynamicAdvice request data:', {
            userId,
            sessionId,
            decisionsCount: Object.keys(decisions).length,
            decisions: Object.entries(decisions).map(([id, decision]) => ({
                id,
                action: decision.action,
                hasModifiedText: !!decision.modifiedText
            }))
        });

        // Retrieve stored suggestions from database
        let storedData;
        try {
            const docRef = db.collection('dynamicAdvice').doc(sessionId);
            const doc = await docRef.get();
            
            if (!doc.exists) {
                console.log('[DEBUG] applyDynamicAdvice: Session not found in database:', sessionId);
                return res.status(404).json({ success: false, error: 'Session not found' });
            }
            
            storedData = doc.data();
            
            if (storedData.userId !== userId) {
                console.log('[DEBUG] applyDynamicAdvice: User mismatch', {
                    storedUserId: storedData.userId,
                    requestUserId: userId
                });
                return res.status(403).json({ success: false, error: 'Unauthorized access to session' });
            }
            
            console.log('[DEBUG] applyDynamicAdvice: Retrieved stored data', {
                suggestionsCount: storedData.suggestions?.length,
                transcript: storedData.transcript?.substring(0, 100) + '...',
                guidelineTitle: storedData.guidelineTitle
            });
            
        } catch (dbError) {
            console.error('[DEBUG] applyDynamicAdvice: Database retrieval error:', dbError.message);
            return res.status(500).json({ success: false, error: 'Failed to retrieve session data' });
        }

        const { transcript, suggestions, guidelineTitle, guidelineId } = storedData;

        // Create AI prompt to apply user decisions to transcript
        const systemPrompt = `You are a medical AI assistant that applies user decisions to clinical transcripts based on guideline suggestions.

You will receive:
1. An original transcript
2. A list of suggestions with user decisions (accept, reject, or modify)
3. For modifications, the user's custom text

Your task is to apply only the ACCEPTED and MODIFIED suggestions to create an updated transcript. For each change:
- ACCEPTED suggestions: Apply the suggested text exactly as provided
- MODIFIED suggestions: Apply the user's modified text instead of the original suggestion
- REJECTED suggestions: Leave the original text unchanged

Return the updated transcript as clean, properly formatted medical text. Maintain the original structure and formatting as much as possible while incorporating the accepted changes.

Important guidelines:
- Only apply changes that the user has accepted or modified
- Preserve the medical accuracy and professional tone
- Maintain logical flow and readability
- Do not add any explanatory text or comments
- Return only the updated transcript`;

        // Process decisions and create change instructions
        const acceptedChanges = [];
        const modifiedChanges = [];
        const rejectedChanges = [];

        suggestions.forEach(suggestion => {
            const decision = decisions[suggestion.id];
            if (!decision) {
                console.log('[DEBUG] applyDynamicAdvice: No decision for suggestion:', suggestion.id);
                return;
            }

            console.log('[DEBUG] applyDynamicAdvice: Processing decision', {
                suggestionId: suggestion.id,
                action: decision.action,
                originalText: suggestion.originalText?.substring(0, 50),
                suggestedText: suggestion.suggestedText?.substring(0, 50)
            });

            switch (decision.action) {
                case 'accept':
                    acceptedChanges.push(suggestion);
                    break;
                case 'modify':
                    modifiedChanges.push({
                        ...suggestion,
                        modifiedText: decision.modifiedText
                    });
                    break;
                case 'reject':
                    rejectedChanges.push(suggestion);
                    break;
                default:
                    console.log('[DEBUG] applyDynamicAdvice: Unknown action:', decision.action);
            }
        });

        console.log('[DEBUG] applyDynamicAdvice: Decision summary', {
            accepted: acceptedChanges.length,
            modified: modifiedChanges.length,
            rejected: rejectedChanges.length
        });

        // Create detailed instructions for AI
        const changeInstructions = [
            ...acceptedChanges.map(change => 
                `ACCEPT: Replace "${change.originalText}" with "${change.suggestedText}" (Reason: ${change.context})`
            ),
            ...modifiedChanges.map(change => 
                `MODIFY: Replace "${change.originalText}" with "${change.modifiedText}" (User's custom modification)`
            )
        ].join('\n');

        const userPrompt = `Original Transcript:
${transcript}
Apply these changes:
${changeInstructions}

Return the updated transcript with these changes applied.`;

        console.log('[DEBUG] applyDynamicAdvice: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            changesCount: acceptedChanges.length + modifiedChanges.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log('[DEBUG] applyDynamicAdvice: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] applyDynamicAdvice: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response from transcript update' });
        }

        // Update database with user decisions and final result
        try {
            const docRef = db.collection('dynamicAdvice').doc(sessionId);
            await docRef.update({
                decisions,
                updatedTranscript: aiResponse.content,
                status: 'completed',
                completedAt: admin.firestore.FieldValue.serverTimestamp(),
                changesSummary: {
                    accepted: acceptedChanges.length,
                    modified: modifiedChanges.length,
                    rejected: rejectedChanges.length
                }
            });
            console.log('[DEBUG] applyDynamicAdvice: Updated database with final results');
        } catch (dbError) {
            console.error('[DEBUG] applyDynamicAdvice: Database update error:', dbError.message);
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    session_id: sessionId,
                    original_transcript_length: transcript.length,
                    changes_applied: acceptedChanges.length + modifiedChanges.length,
                    decisions_summary: {
                        accepted: acceptedChanges.length,
                        modified: modifiedChanges.length,
                        rejected: rejectedChanges.length
                    }
                },
                {
                    success: true,
                    response: aiResponse.content,
                    updated_transcript_length: aiResponse.content.length,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage
                },
                'applyDynamicAdvice'
            );
            console.log('[DEBUG] applyDynamicAdvice: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] applyDynamicAdvice: Error logging AI interaction:', logError.message);
        }

        console.log('[DEBUG] applyDynamicAdvice: Returning response', {
            sessionId,
            originalLength: transcript.length,
            updatedLength: aiResponse.content.length,
            changesApplied: acceptedChanges.length + modifiedChanges.length
        });

        res.json({
            success: true,
            sessionId,
            originalTranscript: transcript,
            updatedTranscript: aiResponse.content,
            changesSummary: {
                accepted: acceptedChanges.length,
                modified: modifiedChanges.length,
                rejected: rejectedChanges.length,
                total: suggestions.length
            }
        });

    } catch (error) {
        console.error('[DEBUG] applyDynamicAdvice: Error in endpoint:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.uid,
            sessionId: req.body?.sessionId,
            decisionsCount: req.body?.decisions ? Object.keys(req.body.decisions).length : 0
        });
        res.status(500).json({ success: false, error: error.message });
    }
});
// Migration function to add downloadUrl field to existing guidelines
async function migrateGuidelineUrls() {
    try {
        console.log('Starting migration to add downloadUrl fields...');
        
        const collections = ['guidelines_obstetrics', 'guidelines_gynaecology'];
        let totalUpdated = 0;
        
        for (const collectionName of collections) {
            console.log(`Processing collection: ${collectionName}`);
            const snapshot = await db.collection(collectionName).get();
            
            for (const doc of snapshot.docs) {
                const data = doc.data();
                
                // Skip if downloadUrl already exists
                if (data.downloadUrl) {
                    continue;
                }
                
                // Construct downloadUrl from filename
                if (data.filename) {
                    const encodedFilename = encodeURIComponent(data.filename);
                    const downloadUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodedFilename}`;
                    
                    await doc.ref.update({ downloadUrl });
                    console.log(`Updated ${doc.id}: ${downloadUrl}`);
                    totalUpdated++;
                } else {
                    console.warn(`No filename found for document: ${doc.id}`);
                }
            }
        }
        
        console.log(`Migration completed. Updated ${totalUpdated} documents.`);
        return { success: true, updated: totalUpdated };
    } catch (error) {
        console.error('Migration failed:', error);
        return { success: false, error: error.message };
    }
}
// Add endpoint to trigger migration
app.post('/migrate-guideline-urls', authenticateUser, async (req, res) => {
    try {
        const result = await migrateGuidelineUrls();
        res.json(result);
    } catch (error) {
        console.error('Migration endpoint error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});
// Chat history endpoints
app.post('/saveChatHistory', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { chat } = req.body;
        
        if (!chat || !chat.id) {
            return res.status(400).json({ success: false, error: 'Chat data and ID are required' });
        }
        
        // Ensure the chat belongs to the authenticated user
        const chatData = {
            ...chat,
            userId: userId,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        // Save to Firestore
        const chatRef = db.collection('users').doc(userId).collection('chatHistory').doc(chat.id.toString());
        await chatRef.set(chatData);
        
        console.log(`[CHAT_HISTORY] Saved chat ${chat.id} for user ${userId}`);
        res.json({ success: true, message: 'Chat saved successfully' });
        
    } catch (error) {
        console.error('[CHAT_HISTORY] Error saving chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/getChatHistory', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        // Load chat history from Firestore
        const chatHistoryRef = db.collection('users').doc(userId).collection('chatHistory');
        const snapshot = await chatHistoryRef.orderBy('lastUpdated', 'desc').get();
        
        const chats = [];
        snapshot.forEach(doc => {
            const chat = doc.data();
            // Ensure the chat has the required structure
            if (chat.id && chat.state) {
                chats.push(chat);
            }
        });
        
        console.log(`[CHAT_HISTORY] Loaded ${chats.length} chats for user ${userId}`);
        res.json({ success: true, chats });
        
    } catch (error) {
        console.error('[CHAT_HISTORY] Error loading chat history:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/deleteChatHistory', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { chatId } = req.body;
        
        if (!chatId) {
            return res.status(400).json({ success: false, error: 'Chat ID is required' });
        }
        
        // Delete from Firestore
        const chatRef = db.collection('users').doc(userId).collection('chatHistory').doc(chatId.toString());
        await chatRef.delete();
        
        console.log(`[CHAT_HISTORY] Deleted chat ${chatId} for user ${userId}`);
        res.json({ success: true, message: 'Chat deleted successfully' });
        
    } catch (error) {
        console.error('[CHAT_HISTORY] Error deleting chat:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Chat summary generation endpoint
app.post('/generateChatSummary', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { userInput } = req.body;
        
        if (!userInput) {
            return res.status(400).json({ success: false, error: 'User input is required' });
        }
        
        // Create a simple prompt for generating a 4-8 word summary
        const systemPrompt = `You are a medical assistant. Generate a concise 4-8 word summary of the clinical scenario described. Focus on the main clinical issue or patient presentation. Use medical terminology where appropriate.`;
        
        const userPrompt = `Please provide a 4-8 word summary of this clinical scenario: ${userInput}`;
        
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
        
        const aiResponse = await routeToAI({ messages }, userId);
        
        if (!aiResponse || !aiResponse.content) {
            throw new Error('Failed to generate summary from AI');
        }
        
        // Clean up the response to ensure it's 4-8 words
        let summary = aiResponse.content.trim();
        
        // Remove any quotes or extra formatting
        summary = summary.replace(/^["']|["']$/g, '');
        
        // Ensure it's not too long (max 60 characters for 4-8 words)
        if (summary.length > 60) {
            summary = summary.substring(0, 60).replace(/\s+\w*$/, '');
        }
        
        console.log(`[CHAT_SUMMARY] Generated summary for user ${userId}: "${summary}"`);
        
        res.json({ 
            success: true, 
            summary: summary,
            ai_provider: aiResponse.ai_provider,
            ai_model: aiResponse.ai_model
        });
        
    } catch (error) {
        console.error('[CHAT_SUMMARY] Error generating chat summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Ask Guidelines Question endpoint - answers questions using relevant guidelines
app.post('/askGuidelinesQuestion', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] askGuidelinesQuestion endpoint called');
        const { question, relevantGuidelines } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!question) {
            console.log('[DEBUG] askGuidelinesQuestion: Missing question');
            return res.status(400).json({ success: false, error: 'Question is required' });
        }
        
        if (!relevantGuidelines || !Array.isArray(relevantGuidelines) || relevantGuidelines.length === 0) {
            console.log('[DEBUG] askGuidelinesQuestion: Missing or invalid relevant guidelines');
            return res.status(400).json({ success: false, error: 'Relevant guidelines array is required' });
        }

        console.log('[DEBUG] askGuidelinesQuestion request data:', {
            userId,
            questionLength: question.length,
            guidelinesCount: relevantGuidelines.length,
            guidelines: relevantGuidelines.map(g => ({ id: g.id, title: g.title }))
        });

        // Fetch full guideline content for each relevant guideline
        const guidelinesWithContent = [];
        for (const guideline of relevantGuidelines) {
            try {
                console.log(`[DEBUG] askGuidelinesQuestion: Fetching content for guideline: ${guideline.id}`);
                const fullGuideline = await getGuideline(guideline.id);
                if (fullGuideline) {
                    guidelinesWithContent.push({
                        ...guideline,
                        content: fullGuideline.content || fullGuideline.condensed || '',
                        summary: fullGuideline.summary || ''
                    });
                } else {
                    console.warn(`[DEBUG] askGuidelinesQuestion: Could not fetch guideline content for: ${guideline.id}`);
                    // Still include the guideline with available data
                    guidelinesWithContent.push(guideline);
                }
            } catch (guidelineError) {
                console.warn(`[DEBUG] askGuidelinesQuestion: Error fetching guideline ${guideline.id}:`, guidelineError.message);
                // Still include the guideline with available data
                guidelinesWithContent.push(guideline);
            }
        }

        console.log('[DEBUG] askGuidelinesQuestion: Retrieved guidelines with content:', {
            count: guidelinesWithContent.length,
            withContent: guidelinesWithContent.filter(g => g.content).length
        });

        // Create system prompt for answering questions based on guidelines
        const systemPrompt = `You are a medical AI assistant that answers clinical questions based on relevant medical guidelines. Your role is to:

1. Analyze the user's question carefully
2. Review the provided relevant guidelines thoroughly
3. Provide a comprehensive, evidence-based answer that directly addresses the question
4. Reference specific guidelines and their recommendations when applicable
5. Use clear, professional medical language
6. If the guidelines don't fully address the question, acknowledge this and provide the best available guidance
7. Structure your response in a clear, organized manner

Always base your answers on the provided guidelines and clearly indicate when you're referencing specific guideline recommendations.`;

        // Create user prompt with question and guidelines
        const guidelinesText = guidelinesWithContent.map(guideline => {
            let guidelineText = `**${guideline.title || guideline.id}**`;
            if (guideline.organisation) {
                guidelineText += ` (${guideline.organisation})`;
            }
            if (guideline.summary) {
                guidelineText += `\nSummary: ${guideline.summary}`;
            }
            if (guideline.content) {
                guidelineText += `\nContent: ${guideline.content}`;
            }
            return guidelineText;
        }).join('\n\n');

        const userPrompt = `**Question:** ${question}

**Relevant Guidelines:**
${guidelinesText}

Please provide a comprehensive answer to the question based on the relevant guidelines above. Structure your response clearly and reference specific guidelines when applicable.`;

        console.log('[DEBUG] askGuidelinesQuestion: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            guidelinesCount: guidelinesWithContent.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log('[DEBUG] askGuidelinesQuestion: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] askGuidelinesQuestion: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    question_length: question.length,
                    guidelines_count: guidelinesWithContent.length,
                    guidelines: guidelinesWithContent.map(g => ({ id: g.id, title: g.title }))
                },
                {
                    success: true,
                    response: aiResponse.content,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage
                },
                'askGuidelinesQuestion'
            );
            console.log('[DEBUG] askGuidelinesQuestion: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] askGuidelinesQuestion: Error logging AI interaction:', logError.message);
        }

        console.log('[DEBUG] askGuidelinesQuestion: Returning response', {
            success: true,
            answerLength: aiResponse.content.length
        });

        res.json({
            success: true,
            answer: aiResponse.content,
            guidelinesUsed: guidelinesWithContent.map(g => ({ id: g.id, title: g.title })),
            ai_provider: aiResponse.ai_provider,
            ai_model: aiResponse.ai_model
        });

    } catch (error) {
        console.error('[DEBUG] askGuidelinesQuestion: Error in endpoint:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.uid,
            question: req.body?.question,
            guidelinesCount: req.body?.relevantGuidelines?.length
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// New endpoint to score compliance of clinical notes against guidelines
app.post('/scoreCompliance', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] scoreCompliance endpoint called');
        const { originalTranscript, recommendedChanges, guidelineId, guidelineTitle } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!originalTranscript) {
            console.log('[DEBUG] scoreCompliance: Missing original transcript');
            return res.status(400).json({ success: false, error: 'Original transcript is required' });
        }
        
        if (!recommendedChanges) {
            console.log('[DEBUG] scoreCompliance: Missing recommended changes');
            return res.status(400).json({ success: false, error: 'Recommended changes are required' });
        }

        console.log('[DEBUG] scoreCompliance request data:', {
            userId,
            transcriptLength: originalTranscript.length,
            changesLength: recommendedChanges.length,
            guidelineId,
            guidelineTitle
        });

        // Fetch the guideline content for context
        let guidelineContent = '';
        if (guidelineId) {
            try {
                console.log('[DEBUG] scoreCompliance: Fetching guideline content for ID:', guidelineId);
                const guideline = await getGuideline(guidelineId);
                guidelineContent = guideline.content || guideline.condensed || '';
                console.log('[DEBUG] scoreCompliance: Retrieved guideline content length:', guidelineContent.length);
            } catch (guidelineError) {
                console.warn('[DEBUG] scoreCompliance: Could not fetch guideline content:', guidelineError.message);
            }
        }

        // Create AI prompt for compliance scoring
        const systemPrompt = `You are a medical AI assistant specialising in clinical documentation compliance assessment.

Your task is to analyse a clinical note against specific medical guidelines and provide a comprehensive compliance score.

SCORING FRAMEWORK:
Evaluate the clinical note across three key dimensions (0-100 scale each):

1. **COMPLETENESS SCORE** (40% weight):
   - How much of the required guideline content is documented
   - Presence of mandatory elements, assessments, and documentation
   - Coverage of all relevant clinical areas specified in the guideline

2. **ACCURACY SCORE** (35% weight):
   - How well the documented content aligns with guideline recommendations
   - Correctness of clinical decisions and interventions
   - Appropriate use of medical terminology and protocols

3. **CLINICAL APPROPRIATENESS SCORE** (25% weight):
   - Whether clinical decisions match guideline criteria for the specific case
   - Appropriateness of investigations and interventions for the clinical scenario
   - Evidence of clinical reasoning aligned with guideline principles

OVERALL COMPLIANCE CALCULATION:
Overall Score = (Completeness × 0.4) + (Accuracy × 0.35) + (Clinical Appropriateness × 0.25)

COMPLIANCE CATEGORIES:
- Excellent (90-100): Fully compliant with guideline requirements
- Good (75-89): Mostly compliant with minor gaps or areas for improvement
- Needs Improvement (60-74): Some compliance issues requiring attention
- Poor (0-59): Significant compliance gaps requiring substantial improvement

RESPONSE FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "overallScore": number (0-100),
  "category": "Excellent|Good|Needs Improvement|Poor",
  "dimensionScores": {
    "completeness": number (0-100),
    "accuracy": number (0-100),
    "clinicalAppropriateness": number (0-100)
  },
  "strengths": [
    "Specific strength 1",
    "Specific strength 2"
  ],
  "improvementAreas": [
    "Specific area needing improvement 1",
    "Specific area needing improvement 2"
  ],
  "keyFindings": {
    "missingElements": ["element1", "element2"],
    "wellDocumented": ["element1", "element2"],
    "needsRevision": ["element1", "element2"]
  },
  "complianceInsights": "Brief summary of overall compliance status and key recommendations"
}

CRITICAL REQUIREMENTS:
- Base your assessment on the specific guideline provided
- Consider the clinical context and appropriateness for the specific case
- Be objective and evidence-based in your scoring
- Provide actionable insights in the improvement areas
- Return ONLY the JSON object - no markdown blocks or additional text`;

        const userPrompt = `Original Clinical Note:
${originalTranscript}

Recommended Changes from Dynamic Advice:
${recommendedChanges}

Guideline: ${guidelineTitle || guidelineId || 'Unknown'}
${guidelineContent ? `\nFull Guideline Content:\n${guidelineContent}` : ''}

Please assess the compliance of the original clinical note against this guideline and provide a comprehensive scoring analysis as specified.`;

        console.log('[DEBUG] scoreCompliance: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        console.log('[DEBUG] scoreCompliance: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] scoreCompliance: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Parse AI response
        let scoringResult = {};
        try {
            // First, try to parse the response directly as JSON
            scoringResult = JSON.parse(aiResponse.content);
            console.log('[DEBUG] scoreCompliance: Parsed scoring result directly:', {
                overallScore: scoringResult.overallScore,
                category: scoringResult.category
            });
        } catch (parseError) {
            console.log('[DEBUG] scoreCompliance: Direct JSON parse failed, trying to extract from markdown:', {
                error: parseError.message,
                rawContentPreview: aiResponse.content.substring(0, 200)
            });
            
            // Try to extract JSON from markdown code blocks
            try {
                let jsonContent = aiResponse.content;
                
                // Remove markdown code blocks if present
                const jsonMatch = jsonContent.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
                if (jsonMatch) {
                    jsonContent = jsonMatch[1];
                    console.log('[DEBUG] scoreCompliance: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        console.log('[DEBUG] scoreCompliance: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                console.log('[DEBUG] scoreCompliance: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                scoringResult = JSON.parse(jsonContent);
                
                console.log('[DEBUG] scoreCompliance: Successfully parsed extracted JSON:', {
                    overallScore: scoringResult.overallScore,
                    category: scoringResult.category
                });
                
            } catch (extractError) {
                console.error('[DEBUG] scoreCompliance: Failed to extract and parse JSON from markdown:', {
                    error: extractError.message,
                    rawContent: aiResponse.content.substring(0, 500)
                });
                
                // Final fallback: create a basic scoring result
                scoringResult = {
                    overallScore: 0,
                    category: 'Poor',
                    dimensionScores: {
                        completeness: 0,
                        accuracy: 0,
                        clinicalAppropriateness: 0
                    },
                    strengths: [],
                    improvementAreas: ['Unable to parse AI response properly. Please try again.'],
                    keyFindings: {
                        missingElements: [],
                        wellDocumented: [],
                        needsRevision: []
                    },
                    complianceInsights: 'There was an issue processing the compliance assessment. Please try again.'
                };
                console.log('[DEBUG] scoreCompliance: Using fallback scoring result');
                
                // Log the full raw content for debugging
                console.error('[DEBUG] scoreCompliance: Full raw AI response for debugging:', aiResponse.content);
            }
        }

        // Add session metadata
        const sessionId = `compliance_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store scoring result in database for tracking
        try {
            const scoringRef = db.collection('complianceScoring').doc(sessionId);
            await scoringRef.set({
                userId,
                sessionId,
                originalTranscript,
                recommendedChanges,
                guidelineId,
                guidelineTitle,
                scoringResult,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log('[DEBUG] scoreCompliance: Stored scoring result in database with sessionId:', sessionId);
        } catch (dbError) {
            console.error('[DEBUG] scoreCompliance: Database storage error:', dbError.message);
            // Continue without failing the request
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    transcript_length: originalTranscript.length,
                    changes_length: recommendedChanges.length,
                    guideline_id: guidelineId,
                    guideline_title: guidelineTitle
                },
                {
                    success: true,
                    response: aiResponse.content,
                    overall_score: scoringResult.overallScore,
                    category: scoringResult.category,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage,
                    session_id: sessionId
                },
                'scoreCompliance'
            );
            console.log('[DEBUG] scoreCompliance: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] scoreCompliance: Error logging AI interaction:', logError.message);
        }

        console.log('[DEBUG] scoreCompliance: Returning response', {
            sessionId,
            overallScore: scoringResult.overallScore,
            category: scoringResult.category,
            success: true
        });

        res.json({
            success: true,
            sessionId,
            scoring: scoringResult,
            guidelineId,
            guidelineTitle,
            ai_provider: aiResponse.ai_provider,
            ai_model: aiResponse.ai_model
        });

    } catch (error) {
        console.error('[DEBUG] scoreCompliance: Error in endpoint:', {
            error: error.message,
            stack: error.stack,
            userId: req.user?.uid,
            requestBody: {
                transcriptLength: req.body?.originalTranscript?.length,
                changesLength: req.body?.recommendedChanges?.length,
                guidelineId: req.body?.guidelineId
            }
        });
        res.status(500).json({ success: false, error: error.message });
    }
});