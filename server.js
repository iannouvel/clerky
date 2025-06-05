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

// Load prompts configuration
let prompts;
try {
    prompts = require('./prompts.json');
} catch (error) {
    console.error('Error loading prompts.json, creating default:', error);
    prompts = {
        guidelines: {
            prompt: "Please identify ONLY the guidelines that DIRECTLY address the management of this specific clinical issue. \nThe guidelines must contain specific recommendations or protocols for managing this exact condition.\n\nRules:\n- Select ONLY guidelines the most relevant 1 or 2 guidelines that have this issue as their primary focus\n- Return ONLY the exact filenames of relevant guidelines\n- List each filename on a new line\n- Do not add any additional text or explanations\n\nIssue: {{text}}\n\nAvailable guidelines:\n{{guidelines}}",
            system_prompt: "You are a medical AI assistant helping to identify relevant clinical guidelines for specific medical issues."
        }
    };
}

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
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

// Override console.error
console.error = (...args) => {
    const message = args.map(arg => {
        if (arg instanceof Error) {
            return `Error: ${arg.message}\nStack: ${arg.stack}`;
        }
        return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg;
    }).join(' ');
    const timestamp = new Date().toISOString();
    serverLogStream.write(`[${timestamp}] [ERROR] ${message}\n`);
    originalConsoleError.apply(console, args); // Also log to the original console
};

const app = express();
const PORT = process.env.PORT || 3000;

// Enable trust proxy
app.set('trust proxy', true);

// Apply helmet first
app.use(helmet());
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", 'https://www.gstatic.com'],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    connectSrc: ["'self'", 'https://api.openai.com', 'https://clerky-uzni.onrender.com'],
    imgSrc: ["'self'", 'data:', 'https:'],
    frameSrc: ["'none'"]
  }
}));

// Increase payload limits
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// --- 1. Centralized CORS Configuration with Logging ---
const corsOptions = {
  origin: (origin, callback) => {
    console.log(`[CORS Origin Check] Request origin: ${origin}`);
    const allowedOrigins = [
      'https://iannouvel.github.io',
      'http://localhost:3000',
      'http://localhost:5500',
      'https://clerkyai.health'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      console.log(`[CORS Origin Check] Origin allowed: ${origin || '(no origin - server-to-server or direct)'}`);
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
    if (!githubToken) {
        console.error('GITHUB_TOKEN is not set!');
        process.exit(1);
    }
    
    // Clean the token
    let cleanToken = githubToken.trim().replace(/\n/g, '');
    
    // Remove Bearer prefix if it exists
    if (cleanToken.startsWith('Bearer ')) {
        cleanToken = cleanToken.substring(7);
    }
    
    // Update the global token
    githubToken = cleanToken;
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

// Initialize Firebase Admin
console.log('Initializing Firebase Admin SDK...');
console.log('Project ID:', process.env.FIREBASE_PROJECT_ID);
console.log('Client Email:', process.env.FIREBASE_CLIENT_EMAIL);
console.log('Private Key exists:', !!process.env.FIREBASE_PRIVATE_KEY);

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
  let privateKey;
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    // Handle base64 encoded private key (preferred method for environment variables)
    console.log('Using base64 encoded private key');
    try {
      privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
      console.log('Successfully decoded base64 private key');
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
  try {
    const crypto = require('crypto');
    const testMessage = 'test';
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(testMessage);
    sign.sign(privateKey); // This will throw if the key is invalid
    console.log('Private key validation successful');
  } catch (keyError) {
    console.error('Private key validation failed:', keyError.message);
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
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  
  console.log('Firebase Admin SDK initialized successfully');
  
  // Initialize Firestore with additional error handling
  db = admin.firestore();
  db.settings({
    ignoreUndefinedProperties: true,
    preferRest: true // Prefer REST API over gRPC
  });
  
  console.log('Firestore instance created with REST API configuration');
  
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', {
    message: error.message,
    stack: error.stack,
    hasProjectId: !!process.env.FIREBASE_PROJECT_ID,
    hasClientEmail: !!process.env.FIREBASE_CLIENT_EMAIL,
    hasPrivateKey: !!process.env.FIREBASE_PRIVATE_KEY,
    privateKeyLength: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.length : 0
  });
  console.log('Continuing without Firebase Firestore due to initialization error');
  console.log('The application will work with limited functionality (no guideline persistence)');
  
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
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}

// Function to send prompts to AI services
async function sendToAI(prompt, model = 'gpt-3.5-turbo', systemPrompt = null, userId = null) {
  try {
    // Determine the provider based on the model, but don't override the model
    let preferredProvider = model.includes('deepseek') ? 'DeepSeek' : 'OpenAI';
    
    console.log('[DEBUG] sendToAI initial configuration:', {
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
    
    console.log('[DEBUG] API key availability:', {
      preferredProvider,
      requestedModel: model,
      hasOpenAIKey,
      hasDeepSeekKey
    });
    
    // If we don't have the key for the preferred provider, fallback to one we do have
    if (preferredProvider === 'OpenAI' && !hasOpenAIKey) {
      if (hasDeepSeekKey) {
        console.log('[DEBUG] Falling back to DeepSeek due to missing OpenAI key');
        preferredProvider = 'DeepSeek';
        // Only update model if it's an OpenAI model
        if (model.includes('gpt')) {
          model = 'deepseek-chat';
        }
      } else {
        throw new Error('No AI provider API keys configured');
      }
    } else if (preferredProvider === 'DeepSeek' && !hasDeepSeekKey) {
      if (hasOpenAIKey) {
        console.log('[DEBUG] Falling back to OpenAI due to missing DeepSeek key');
        preferredProvider = 'OpenAI';
        // Only update model if it's a DeepSeek model
        if (model.includes('deepseek')) {
          model = 'gpt-3.5-turbo';
        }
      } else {
        throw new Error('No AI provider API keys configured');
      }
    }
    
    // Construct the messages array with system prompt if provided
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
        
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
    } else {
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
    throw new Error(`AI request failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Update the route function to use the new sendToAI
async function routeToAI(prompt, userId = null) {
  try {
    // Set default AI provider to DeepSeek
    const defaultProvider = 'DeepSeek';
    
    console.log('[DEBUG] routeToAI called with:', {
      promptLength: prompt?.length,
      promptPreview: prompt?.substring(0, 100) + '...',
      userId: userId || 'none'
    });
    
    // Update local environment variable as a default
    if (!process.env.PREFERRED_AI_PROVIDER) {
      process.env.PREFERRED_AI_PROVIDER = defaultProvider;
    }
    
    // Get the user's preferred AI provider from cache or storage
    let provider = defaultProvider;
    if (userId) {
      try {
        provider = await getUserAIPreference(userId);
        console.log('[DEBUG] User AI preference retrieved:', {
          userId,
          provider,
          defaultProvider
        });
      } catch (error) {
        console.error('[DEBUG] Error getting user AI preference:', {
          error: error.message,
          userId,
          usingDefault: true
        });
        provider = process.env.PREFERRED_AI_PROVIDER || defaultProvider;
      }
    } else {
      console.log('[DEBUG] No user ID provided, using default AI provider:', {
        provider: process.env.PREFERRED_AI_PROVIDER || defaultProvider
      });
      provider = process.env.PREFERRED_AI_PROVIDER || defaultProvider;
    }
    
    // Determine the appropriate model based on the provider
    const model = provider === 'OpenAI' ? 'gpt-3.5-turbo' : 'deepseek-chat';
    console.log('[DEBUG] Selected AI configuration:', {
      provider,
      model,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY
    });
    
    // Send to the appropriate AI service
    console.log('[DEBUG] Sending request to AI service...');
    const result = await sendToAI(prompt, model, null, userId);
    
    console.log('[DEBUG] AI service response:', {
      success: !!result,
      hasContent: !!result?.content,
      contentLength: result?.content?.length,
      contentPreview: result?.content?.substring(0, 100) + '...',
      aiProvider: result?.ai_provider,
      aiModel: result?.ai_model,
      tokenUsage: result?.token_usage
    });
    
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
    
    res.json({ success: true, response });
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
app.post('/newActionEndpoint', async (req, res) => {
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

// Function to check specific GitHub permissions
async function checkGitHubPermissions() {
    try {
        const results = {
            repository: false,
            contents: false,
            workflows: false,
            actions: false,
            details: {}
        };

        // Test repository access
        try {
            const repoResponse = await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            results.repository = true;
            results.details.repository = repoResponse.data.permissions;
        } catch (error) {
            results.details.repository = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        // Test contents access (try to list contents)
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/contents`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            results.contents = true;
        } catch (error) {
            results.details.contents = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        // Test workflows access
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            results.workflows = true;
        } catch (error) {
            results.details.workflows = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        // Test actions access
        try {
            await axios.get(`https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/runs`, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            results.actions = true;
        } catch (error) {
            results.details.actions = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        // Ensure complete commenting of console.log statements
        // console.log('GitHub Permissions Check Results:', {
        //     allPermissionsGranted: Object.values(results).slice(0, 4).every(v => v),
        //     permissions: {
        //         repository: results.repository ? '✅' : '❌',
        //         contents: results.contents ? '✅' : '❌',
        //         workflows: results.workflows ? '✅' : '❌',
        //         actions: results.actions ? '✅' : '❌'
        //     },
        //     details: results.details
        // });

        return results;
    } catch (error) {
        console.error('Error checking GitHub permissions:', error);
        return null;
    }
}

// Function to test GitHub token permissions
async function testGitHubAccess() {
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}`;
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            }
        });
        return true;
    } catch (error) {
        console.error('GitHub access test failed:', {
            status: error.response?.status,
            message: error.response?.data?.message,
            documentation_url: error.response?.data?.documentation_url
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
    
    const jsonBody = {
        message: `Add ${type} log: ${timestamp}`,
        content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
        branch: githubBranch
    };

    const textContent = content.textContent || 
        (type === 'submission' ? 
            `AI: ${content.ai_provider} (${content.ai_model})\n\n${content.prompt?.prompt || JSON.stringify(content, null, 2)}` :
            type === 'reply' && content.response ?
            (typeof content.response === 'string' ? content.response.split('\\n').join('\n') :
            typeof content.response === 'object' && content.response.response ?
            content.response.response.split('\\n').join('\n') : 
            JSON.stringify(content.response, null, 2)) :
            JSON.stringify(content, null, 2));

    // First, try saving to GitHub
    while (attempt < MAX_RETRIES && !success) {
        try {
            console.log(`saveToGitHub attempt ${attempt + 1}/${MAX_RETRIES} for ${type}...`);
            
            if (!githubToken) {
                console.error('GitHub token is missing, falling back to local save');
                break;
            }
            
            if (textContent) {
                const textFilename = `${timestamp}-${type}.txt`;
                const textPath = `logs/ai-interactions/${textFilename}`;
                const textBody = {
                    message: `Add ${type} text: ${timestamp}`,
                    content: Buffer.from(textContent).toString('base64'),
                    branch: githubBranch
                };
                
                console.log(`Attempting to save text file to GitHub: ${textPath}`);
                const textResponse = await axios.put(
                    `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${textPath}`,
                    textBody,
                    {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'Authorization': `token ${githubToken}`
                        }
                    }
                );
                console.log(`Text file saved successfully: ${textPath}`);
            }

            const jsonUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${jsonPath}`;
            console.log(`Attempting to save JSON file to GitHub: ${jsonPath}`);
            const response = await axios.put(jsonUrl, jsonBody, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });

            success = true;
            console.log(`Successfully saved ${type} to GitHub: ${jsonPath}`);
        } catch (error) {
            if (error.response?.status === 409) {
                console.log('Conflict detected, fetching latest SHA and retrying...');
                try {
                    const fileSha = await getFileSha(jsonPath);
                    jsonBody.sha = fileSha;
                } catch (shaError) {
                    console.error('Error getting file SHA:', shaError);
                }
            } else {
                console.error(`Error saving ${type} to GitHub (attempt ${attempt + 1}/${MAX_RETRIES}):`, {
                    status: error.response?.status,
                    message: error.response?.data?.message,
                    documentation_url: error.response?.data?.documentation_url,
                    requestUrl: error.config?.url,
                    requestHeaders: error.config?.headers ? 
                        { ...error.config.headers, Authorization: 'token [REDACTED]' } : 
                        'No headers'
                });
                
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
                        
                        // Write text file
                        const localTextPath = `${localLogsDir}/${timestamp}-${type}.txt`;
                        fs.writeFileSync(localTextPath, textContent);
                        console.log(`Saved text log locally to ${localTextPath}`);
                        
                        // Write JSON file
                        const localJsonPath = `${localLogsDir}/${timestamp}-${type}.json`;
                        fs.writeFileSync(localJsonPath, JSON.stringify(content, null, 2));
                        console.log(`Saved JSON log locally to ${localJsonPath}`);
                        
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
    // Log the raw inputs for debugging
    console.log('logAIInteraction called with:', {
      promptType: typeof prompt,
      responseType: typeof response,
      endpoint,
      responseKeys: response ? Object.keys(response) : 'no response'
    });
    
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
      console.log('Response object structure:', {
        hasContent: 'content' in response,
        hasResponse: 'response' in response,
        hasAIProvider: 'ai_provider' in response,
        hasTokenUsage: 'token_usage' in response,
        hasNestedAIProvider: response.response && typeof response.response === 'object' && 'ai_provider' in response.response
      });
      
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
    console.log('Logging AI interaction:', { endpoint, ai_info });
    
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
        textContent: textContent,
        ai_provider: ai_provider,
        ai_model: ai_model,
        token_usage: token_usage  // Include token usage in the JSON log
      }, endpoint.includes('submit') ? 'submission' : 'reply');
      
      console.log(`Successfully logged AI interaction for endpoint: ${endpoint}`);
      return true;
    } catch (saveError) {
      console.error('Error in saveToGitHub during logAIInteraction:', {
        message: saveError.message,
        stack: saveError.stack,
        endpoint,
        timestamp
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
app.post('/SendToAI', async (req, res) => {
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

// Update the /handleGuidelines endpoint with debugging
app.post('/findRelevantGuidelines', authenticateUser, async (req, res) => {
    try {
        const { transcript, guidelines, summaries } = req.body;
        
        // Debug input validation
        console.log('[DEBUG] findRelevantGuidelines input:', {
            transcriptLength: transcript?.length,
            guidelinesCount: guidelines?.length,
            summariesCount: summaries?.length,
            transcriptPreview: transcript?.substring(0, 100) + '...',
            guidelinesPreview: guidelines?.slice(0, 3),
            summariesPreview: summaries?.slice(0, 3)
        });

        if (!transcript || !guidelines || !summaries) {
            console.error('[DEBUG] Missing required fields:', {
                hasTranscript: !!transcript,
                hasGuidelines: !!guidelines,
                hasSummaries: !!summaries
            });
            return res.status(400).json({
                success: false,
                message: 'Transcript, guidelines, and summaries are required'
            });
        }

        // Load prompts configuration
        const prompts = require('./prompts.json');
        
        // Debug prompts structure
        console.log('[DEBUG] Prompts configuration:', {
            hasPrompts: !!prompts,
            promptsKeys: prompts ? Object.keys(prompts) : 'undefined',
            hasGuidelinesPrompt: prompts?.findRelevantGuidelinesWithProbability?.prompt ? 'yes' : 'no',
            guidelinesPromptLength: prompts?.findRelevantGuidelinesWithProbability?.prompt?.length
        });

        if (!prompts?.findRelevantGuidelinesWithProbability?.prompt) {
            console.error('[DEBUG] Missing guidelines prompt in configuration');
            return res.status(500).json({
                success: false,
                message: 'Guidelines prompt configuration is missing'
            });
        }

        // Get user's AI preference
        let userPreference;
        try {
            userPreference = await getUserAIPreference(req.user.uid);
            console.log('[DEBUG] User AI preference:', {
                userId: req.user.uid,
                preference: userPreference
            });
        } catch (error) {
            console.warn('[DEBUG] Error getting user AI preference:', error);
            userPreference = 'DeepSeek'; // Default to DeepSeek
        }

        // Format the prompt
        const systemPrompt = prompts.findRelevantGuidelinesWithProbability.prompt;
        const userMessage = `
            Transcript: ${transcript}

            Available Guidelines:
            ${guidelines.map((g, i) => `${i + 1}. ${g}`).join('\n')}

            Guideline Summaries:
            ${summaries.map((s, i) => `${i + 1}. ${s}`).join('\n')}
        `;

        console.log('[DEBUG] Formatted AI request:', {
            systemPromptLength: systemPrompt.length,
            userMessageLength: userMessage.length,
            systemPromptPreview: systemPrompt.substring(0, 100) + '...',
            userMessagePreview: userMessage.substring(0, 100) + '...'
        });

        // Send to AI
        console.log('[DEBUG] Sending request to AI service...');
        const response = await routeToAI(userMessage, req.user.uid);
        
        console.log('[DEBUG] AI response received:', {
            hasResponse: !!response,
            responseType: typeof response,
            hasContent: response?.content ? 'yes' : 'no',
            contentLength: response?.content?.length,
            contentPreview: response?.content?.substring(0, 100) + '...',
            aiProvider: response?.ai_provider,
            aiModel: response?.ai_model,
            tokenUsage: response?.token_usage
        });

        if (!response?.content) {
            throw new Error('Invalid response format from AI service');
        }

        // Process AI's response
        const relevantGuidelines = response.content.split('\n')
            .filter(line => line.trim())
            .map(line => {
                const [filename, relevance] = line.split(':').map(s => s.trim());
                return { filename, relevance };
            });

        console.log('[DEBUG] Processed relevant guidelines:', {
            count: relevantGuidelines.length,
            guidelines: relevantGuidelines.slice(0, 3)
        });

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    transcript,
                    guidelines,
                    summaries,
                    system_prompt: systemPrompt
                },
                {
                    success: true,
                    response
                },
                'findRelevantGuidelines'
            );
        } catch (logError) {
            console.error('Error logging AI interaction:', logError);
        }

        res.json({ 
            success: true, 
            relevantGuidelines
        });

    } catch (error) {
        console.error('[DEBUG] Error in findRelevantGuidelines:', {
            error: error.message,
            stack: error.stack,
            prompts: prompts ? 'defined' : 'undefined',
            promptsStructure: prompts ? Object.keys(prompts) : 'undefined'
        });
        res.status(500).json({
            success: false,
            error: error.message
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
        const fallbackProvider = process.env.PREFERRED_AI_PROVIDER || 'OpenAI';
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
      
      if (provider !== 'OpenAI' && provider !== 'DeepSeek') {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid provider. Must be either "OpenAI" or "DeepSeek"'
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
            previousProvider: 'OpenAI',
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

// Start the server
app.listen(PORT, async () => {
    //console.log(`Server is running on http://localhost:${PORT}`);
    //console.log('\nChecking GitHub token and permissions...');
    
    // First validate token format
    validateGitHubToken();
    
    // Then check repository access
    const hasAccess = await testGitHubAccess();
    if (!hasAccess) {
        console.error('\nWARNING: Basic GitHub access test failed!');
    }
    
    // Finally check specific permissions
    const permissions = await checkGitHubPermissions();
    if (!permissions || !Object.values(permissions).slice(0, 4).every(v => v)) {
        console.error('\nWARNING: Some required GitHub permissions are missing!');
        console.error('Please ensure your token has the following permissions:');
        console.error('- repo (Full control of repositories)');
        console.error('- workflow (Update GitHub Action workflows)');
        console.error('- contents (Repository contents access)');
        console.error('- actions (Manage GitHub Actions)');
    }
});

// console.log('All filenames in the guidance folder:', allGuidelines.map(g => g.name));

app.get('/health', (req, res) => {
    res.status(200).json({ message: 'Server is live' });
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
                         model.includes('deepseek') ? 'DeepSeek' : 'Unknown');
    
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
    const { transcript } = req.body;

    if (!transcript) {
        return res.status(400).json({ success: false, message: 'Transcript is required' });
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
      guidelineId: guideline.id,
      name: guideline.name,
      content: guideline.content,
      relevance: guideline.relevance,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }
  
  await batch.commit();
}

async function storeGuidelineCheck(sessionId, userId, guidelineId, checkResult) {
  const checkRef = db.collection('guidelineChecks').doc();
  await checkRef.set({
    sessionId,
    userId,
    guidelineId,
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
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are a medical guidelines analyzer. Your task is to identify which guidelines are most relevant to the given medical case. For each guideline, provide a relevance score from 0-100 and a brief explanation of why it's relevant or not."
        },
        {
          role: "user",
          content: `Medical Case:\n${prompt}\n\nAvailable Guidelines:\n${guidelinesList}`
        }
      ],
      temperature: 0.3,
      max_tokens: 2000
    });

    const aiResponse = response.choices[0].message.content;
    
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
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "You are a medical guidelines compliance checker. Your task is to analyze if the given medical case follows the specified guideline. Provide a detailed analysis and specific recommendations if the case doesn't comply."
          },
          {
            role: "user",
            content: `Medical Case:\n${transcript}\n\nGuideline to check:\n${guideline.name} - ${guideline.content}`
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });

      const checkResult = {
        guidelineId: guideline.id,
        name: guideline.name,
        analysis: response.choices[0].message.content,
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
  const { id, title, content, summary, keywords, condensed, humanFriendlyName, yearProduced, organisation, doi } = guidelineData;
  
  const batch = db.batch();
  
  // Store main guideline
  const guidelineRef = db.collection('guidelines').doc(id);
  batch.set(guidelineRef, {
    title,
    content,
    humanFriendlyName,
    yearProduced,
    organisation,
    doi,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Store summary
  const summaryRef = db.collection('guidelineSummaries').doc(id);
  batch.set(summaryRef, {
    title,
    summary,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Store keywords
  const keywordsRef = db.collection('guidelineKeywords').doc(id);
  batch.set(keywordsRef, {
    title,
    keywords,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // Store condensed version
  const condensedRef = db.collection('guidelineCondensed').doc(id);
  batch.set(condensedRef, {
    title,
    condensed,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await batch.commit();
}

async function getGuideline(id) {
  const [guideline, summary, keywords, condensed] = await Promise.all([
    db.collection('guidelines').doc(id).get(),
    db.collection('guidelineSummaries').doc(id).get(),
    db.collection('guidelineKeywords').doc(id).get(),
    db.collection('guidelineCondensed').doc(id).get()
  ]);

  if (!guideline.exists) {
    throw new Error('Guideline not found');
  }

  return {
    id,
    title: guideline.data().title,
    content: guideline.data().content,
    summary: summary.exists ? summary.data().summary : null,
    keywords: keywords.exists ? keywords.data().keywords : [],
    condensed: condensed.exists ? condensed.data().condensed : null
  };
}

async function getAllGuidelines() {
  try {
    console.log('[DEBUG] getAllGuidelines function called');
    
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

    console.log('[DEBUG] Collection sizes:', {
      guidelines: guidelines.size,
      summaries: summaries.size,
      keywords: keywords.size,
      condensed: condensed.size
    });

    const guidelineMap = new Map();
    
    // Process main guidelines
    guidelines.forEach(doc => {
      guidelineMap.set(doc.id, {
        id: doc.id,
        title: doc.data().title,
        content: doc.data().content,
        summary: null,
        keywords: [],
        condensed: null
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
        error.message.includes('unsupported') ||
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

        // Construct the AI prompt
        const fieldsList = fields.map(f => `- ${f}`).join('\n');
        const prompt = `You are an expert at extracting metadata from clinical guidelines.\n\nGiven the following guideline text, extract the following metadata fields and return them as a JSON object with keys exactly as specified:\n${fieldsList}\n\nGuideline Text:\n"""\n${guidelineText.substring(0, 6000)}\n"""\n\nIf a field is not present, return null for that field. Respond ONLY with the JSON object.`;

        // Send to AI
        const aiResult = await routeToAI(prompt, req.user.uid);
        let aiContent = aiResult && typeof aiResult === 'object' ? aiResult.content : aiResult;
        if (!aiContent) {
            throw new Error('No response from AI');
        }

        // Try to parse the JSON from the AI's response
        let metadata = null;
        try {
            // Find the first JSON object in the response
            const match = aiContent.match(/\{[\s\S]*\}/);
            if (match) {
                metadata = JSON.parse(match[0]);
            } else {
                throw new Error('No JSON object found in AI response');
            }
        } catch (parseErr) {
            return res.status(500).json({ success: false, message: 'Failed to parse AI response as JSON', aiContent });
        }

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
        // Check if guideline already exists in Firestore
        const guidelineRef = db.collection('guidelines').doc(guideline); // Use encoded name for Firestore ID too, or decide on a consistent ID strategy
        const guidelineDoc = await guidelineRef.get();

        if (guidelineDoc.exists) {
          console.log(`[SYNC_META] Guideline ${guideline} already exists in Firestore. Skipping.`);
          results.push({ guideline, success: true, message: 'Guideline already exists in Firestore' });
          continue;
        }
        console.log(`[SYNC_META] Guideline ${guideline} not found in Firestore. Proceeding with sync.`);

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

        // Extract metadata using the /extractGuidelineMetadata endpoint
        console.log(`[SYNC_META] Calling /extractGuidelineMetadata for ${guideline}...`);
        const metadataResponse = await fetch(`${req.protocol}://${req.get('host')}/extractGuidelineMetadata`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${req.headers.authorization.split(' ')[1]}`
          },
          body: JSON.stringify({
            guidelineText: guidelineContent,
            fields: ["human-friendly name", "year produced", "organisation", "doi"]
          })
        });
        console.log(`[SYNC_META] /extractGuidelineMetadata call for ${guideline} completed. Status: ${metadataResponse.status}`);

        if (!metadataResponse.ok) {
          const errorText = await metadataResponse.text();
          throw new Error(`Failed to extract metadata for ${guideline}. Status: ${metadataResponse.status} - ${errorText}`);
        }

        const { metadata } = await metadataResponse.json();
        console.log(`[SYNC_META] Successfully extracted metadata for ${guideline}:`, metadata);

        // Store in Firestore with metadata
        console.log(`[SYNC_META] Storing ${guideline} with metadata in Firestore...`);
        await storeGuideline({
          id: guideline, // Storing with encoded name as ID
          title: rawGuidelineName, // Store raw name as title for display
          content: guidelineContent,
          summary: guidelineSummary,
          keywords: extractKeywords(guidelineSummary),
          condensed: guidelineContent,
          humanFriendlyName: metadata["human-friendly name"],
          yearProduced: metadata["year produced"],
          organisation: metadata["organisation"],
          doi: metadata["doi"]
        });
        console.log(`[SYNC_META] Successfully stored ${guideline} in Firestore.`);

        results.push({ guideline, success: true, message: 'Guideline synced successfully' });
      } catch (error) {
        console.error(`[SYNC_META] Error processing guideline ${rawGuidelineName} (encoded: ${guideline}):`, error.message);
        results.push({ guideline: rawGuidelineName, success: false, error: error.message });
      }
    }

    console.log('[SYNC_META] Finished processing all guidelines.', results);
    res.json({ success: true, results });
  } catch (error) {
    console.error('[SYNC_META] Critical error in /syncGuidelinesWithMetadata endpoint:', error);
    res.status(500).json({ error: error.message, details: 'Outer catch block in /syncGuidelinesWithMetadata' });
  }
});

// Endpoint to get all guidelines
app.get('/getAllGuidelines', authenticateUser, async (req, res) => {
    try {
        console.log('[DEBUG] getAllGuidelines endpoint called');
        
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

        console.log('[DEBUG] Calling getAllGuidelines function');
        const guidelines = await getAllGuidelines();
        console.log('[DEBUG] getAllGuidelines returned:', guidelines.length, 'guidelines');
        
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
