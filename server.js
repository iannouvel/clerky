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
const cheerio = require('cheerio');

// ============================================================================
// GUIDELINE DISCOVERY HELPERS
// ============================================================================

// URL domain validation for each organization
const ORGANIZATION_DOMAINS = {
    'RCOG': ['rcog.org.uk'],
    'NICE': ['nice.org.uk'],
    'FSRH': ['fsrh.org'],
    'BASHH': ['bashh.org', 'bashhguidelines.org'],
    'BMS': ['thebms.org.uk'],
    'BSH': ['b-s-h.org.uk'],
    'BHIVA': ['bhiva.org'],
    'BAPM': ['bapm.org'],
    'UK NSC': ['gov.uk'],
    'NHS England': ['england.nhs.uk'],
    'BSGE': ['bsge.org.uk'],
    'BSUG': ['bsug.org'],
    'BGCS': ['bgcs.org.uk'],
    'BSCCP': ['bsccp.org.uk'],
    'BFS': ['britishfertilitysociety.org.uk'],
    'BMFMS': ['bmfms.org.uk'],
    'BritSPAG': ['britspag.org']
};

// Validate URL matches expected domain for organization
function validateGuidelineUrl(url, organization) {
    if (!url || !organization) return false;
    
    const expectedDomains = ORGANIZATION_DOMAINS[organization];
    if (!expectedDomains) return false;
    
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        
        return expectedDomains.some(domain => 
            hostname === domain || hostname.endsWith('.' + domain)
        );
    } catch (e) {
        return false;
    }
}

// Web scraping for RCOG guidelines
async function scrapeRCOGGuidelines() {
    const guidelines = [];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    try {
        // Scrape Green-top Guidelines - look for direct PDF links
        const url = 'https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/';
        const response = await axios.get(url, { headers, timeout: 30000 });
        const $ = cheerio.load(response.data);
        
        // Look for PDF links within guideline containers
        // RCOG typically structures as: card/item containing both title link and PDF download link
        $('.o-card, .c-card, .guideline-item, [class*="guideline"]').each((index, container) => {
            const $container = $(container);
            
            // Find title (look for the main link, usually not a PDF)
            const $titleLink = $container.find('a[href*="green-top-guideline"]:not([href$=".pdf"])').first();
            const title = $titleLink.text().trim();
            
            // Find PDF link within the same container
            const $pdfLink = $container.find('a[href*=".pdf"], a[href*="/media/"]').first();
            let pdfUrl = $pdfLink.attr('href');
            
            if (pdfUrl && !pdfUrl.startsWith('http')) {
                pdfUrl = 'https://www.rcog.org.uk' + pdfUrl;
            }
            
            const numberMatch = title.match(/No\.\s*(\d+[a-z]?)/i);
            const yearMatch = title.match(/\b(20\d{2})\b/);
            
            // Only add if we have both title and a PDF URL
            if (title && pdfUrl && pdfUrl.includes('.pdf')) {
                guidelines.push({
                    title,
                    organisation: 'RCOG',
                    type: 'Green-top Guideline',
                    year: yearMatch ? parseInt(yearMatch[1]) : null,
                    url: pdfUrl,
                    canonicalId: numberMatch ? `RCOG-GTG-${numberMatch[1]}` : null
                });
            }
        });
        
        // Fallback: if no PDFs found using container method, try direct PDF link scraping
        if (guidelines.length === 0) {
            console.log('[SCRAPING] No PDFs found in containers, trying direct PDF links...');
            $('a[href*=".pdf"][href*="gtg"], a[href*=".pdf"][href*="green-top"]').each((index, element) => {
                const $el = $(element);
                const linkText = $el.text().trim();
                let pdfUrl = $el.attr('href');
                
                if (pdfUrl && !pdfUrl.startsWith('http')) {
                    pdfUrl = 'https://www.rcog.org.uk' + pdfUrl;
                }
                
                // Try to find title from nearby text or link text
                const title = linkText || $el.closest('div, li, article').find('h2, h3, h4, .title').text().trim() || 'Unknown';
                const numberMatch = title.match(/No\.\s*(\d+[a-z]?)/i) || pdfUrl.match(/gtg[_-]?(\d+[a-z]?)/i);
                const yearMatch = title.match(/\b(20\d{2})\b/) || pdfUrl.match(/\b(20\d{2})\b/);
                
                if (pdfUrl && pdfUrl.includes('.pdf')) {
                    guidelines.push({
                        title,
                        organisation: 'RCOG',
                        type: 'Green-top Guideline',
                        year: yearMatch ? parseInt(yearMatch[1]) : null,
                        url: pdfUrl,
                        canonicalId: numberMatch ? `RCOG-GTG-${numberMatch[1]}` : null
                    });
                }
            });
        }
        
        debugLog(`[SCRAPING] Found ${guidelines.length} RCOG guidelines`);
    } catch (error) {
        console.error('[SCRAPING] Error scraping RCOG:', error.message);
    }
    
    return guidelines;
}

// Web scraping for NICE guidelines
async function scrapeNICEGuidelines() {
    const guidelines = [];
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    };
    
    // Expanded O&G-relevant NICE codes
    const maternityCodes = [
        // Pregnancy and antenatal
        'NG201', 'NG194', 'NG235', 'NG121', 'CG190', 'NG3',
        // Intrapartum and postnatal  
        'CG192', 'NG133', 'CG37',
        // Fertility and reproductive health
        'CG156', 'NG23', 'NG137',
        // Gynaecological conditions
        'NG88', 'NG4', 'NG25', 'NG126', 'CG149',
        // Quality standards
        'QS22', 'QS109', 'QS115', 'QS200',
        // Public health
        'PH11', 'PH26', 'PH27'
    ];
    
    for (const code of maternityCodes) {
        try {
            const url = `https://www.nice.org.uk/guidance/${code.toLowerCase()}`;
            const response = await axios.get(url, {
                headers,
                timeout: 30000,
                validateStatus: status => status === 200
            });
            
            const $ = cheerio.load(response.data);
            const title = $('h1.page-header__heading').text().trim() || 
                         $('h1').first().text().trim() || 
                         code;
            
            const dateText = $('dd.published-date, .published-date, [class*="date"]').text().trim();
            const yearMatch = dateText.match(/\b(20\d{2})\b/) || title.match(/\b(20\d{2})\b/);
            
            const type = code.startsWith('NG') ? 'NICE Guideline' :
                        code.startsWith('CG') ? 'Clinical Guideline' :
                        code.startsWith('QS') ? 'Quality Standard' :
                        code.startsWith('PH') ? 'Public Health Guideline' : 'NICE Guidance';
            
            // Try to find direct PDF download link
            let pdfUrl = null;
            
            // Method 1: Look for explicit download links
            const downloadLinks = $('a[href*=".pdf"], a[href*="/resources/"], a:contains("Download"), a:contains("PDF")').toArray();
            for (const link of downloadLinks) {
                const $link = $(link);
                const href = $link.attr('href');
                const linkText = $link.text().toLowerCase();
                
                // Prefer links that mention "full guideline" or "PDF" and contain the code
                if (href && (href.includes('.pdf') || href.includes('/resources/'))) {
                    const isRelevant = linkText.includes('full') || 
                                     linkText.includes('guideline') || 
                                     linkText.includes('download') ||
                                     linkText.includes('pdf') ||
                                     href.toLowerCase().includes(code.toLowerCase());
                    
                    if (isRelevant) {
                        pdfUrl = href.startsWith('http') ? href : `https://www.nice.org.uk${href}`;
                        break;
                    }
                }
            }
            
            // Method 2: Construct expected PDF URL based on NICE's URL pattern
            if (!pdfUrl) {
                // NICE often uses pattern: /guidance/{code}/resources/{code}-pdf-{number}
                const resourcesUrl = `${url}/resources`;
                try {
                    const resourcesResponse = await axios.get(resourcesUrl, {
                        headers,
                        timeout: 10000,
                        validateStatus: status => status === 200
                    });
                    const $resources = cheerio.load(resourcesResponse.data);
                    const firstPdf = $resources('a[href*=".pdf"]').first().attr('href');
                    if (firstPdf) {
                        pdfUrl = firstPdf.startsWith('http') ? firstPdf : `https://www.nice.org.uk${firstPdf}`;
                    }
                } catch (e) {
                    // Resources page not found, continue
                }
            }
            
            // Method 3: Try common NICE PDF URL patterns
            if (!pdfUrl) {
                const commonPatterns = [
                    `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf`,
                    `https://www.nice.org.uk/guidance/${code.toLowerCase()}/resources/${code.toLowerCase()}-pdf-${Math.floor(Math.random() * 10000000000000)}`, // NICE uses random numbers
                ];
                
                for (const pattern of commonPatterns) {
                    try {
                        const testResponse = await axios.head(pattern, { headers, timeout: 5000 });
                        if (testResponse.status === 200) {
                            pdfUrl = pattern;
                            break;
                        }
                    } catch (e) {
                        // Pattern didn't work, try next
                    }
                }
            }
            
            // Use PDF URL if found, otherwise fall back to page URL
            const finalUrl = pdfUrl || url;
            
            guidelines.push({
                title,
                organisation: 'NICE',
                type,
                year: yearMatch ? parseInt(yearMatch[1]) : null,
                url: finalUrl,
                canonicalId: `NICE-${code.toUpperCase()}`
            });
            
        } catch (error) {
            // Silently skip codes that don't exist
            if (!error.response || error.response.status !== 404) {
                console.warn(`[SCRAPING] Could not fetch NICE ${code}:`, error.message);
            }
        }
    }
    
    debugLog(`[SCRAPING] Found ${guidelines.length} NICE guidelines`);
    return guidelines;
}

// ============================================================================
// AI PROVIDER COST-EFFECTIVE ITERATION SYSTEM
// ============================================================================

// Comprehensive AI Model Registry - all available models per provider with accurate pricing
// Pricing is per 1k tokens (input/output separated for accuracy)
const AI_MODEL_REGISTRY = {
  OpenAI: {
    keyEnv: 'OPENAI_API_KEY',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { model: 'gpt-4o', displayName: 'GPT-4o', costPer1kInput: 0.0025, costPer1kOutput: 0.01, description: 'Most capable OpenAI model' },
      { model: 'gpt-4o-mini', displayName: 'GPT-4o Mini', costPer1kInput: 0.00015, costPer1kOutput: 0.0006, description: 'Fast and affordable' },
      { model: 'gpt-4-turbo', displayName: 'GPT-4 Turbo', costPer1kInput: 0.01, costPer1kOutput: 0.03, description: 'Previous flagship model' },
      { model: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', costPer1kInput: 0.0005, costPer1kOutput: 0.0015, description: 'Legacy fast model' }
    ]
  },
  Anthropic: {
    keyEnv: 'ANTHROPIC_API_KEY',
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      { model: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', costPer1kInput: 0.003, costPer1kOutput: 0.015, description: 'Latest Claude model' },
      { model: 'claude-3-5-sonnet-20241022', displayName: 'Claude 3.5 Sonnet', costPer1kInput: 0.003, costPer1kOutput: 0.015, description: 'Excellent reasoning' },
      { model: 'claude-3-haiku-20240307', displayName: 'Claude 3 Haiku', costPer1kInput: 0.00025, costPer1kOutput: 0.00125, description: 'Fast and cost-effective' }
    ]
  },
  DeepSeek: {
    keyEnv: 'DEEPSEEK_API_KEY',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { model: 'deepseek-chat', displayName: 'DeepSeek Chat', costPer1kInput: 0.00014, costPer1kOutput: 0.00028, description: 'Very cost-effective' },
      { model: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', costPer1kInput: 0.00055, costPer1kOutput: 0.00219, description: 'Advanced reasoning (R1)' }
    ]
  },
  Mistral: {
    keyEnv: 'MISTRAL_API_KEY',
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      { model: 'mistral-large-latest', displayName: 'Mistral Large', costPer1kInput: 0.002, costPer1kOutput: 0.006, description: 'Most capable Mistral' },
      { model: 'mistral-small-latest', displayName: 'Mistral Small', costPer1kInput: 0.0002, costPer1kOutput: 0.0006, description: 'Fast and affordable' }
    ]
  },
  Gemini: {
    keyEnv: 'GOOGLE_AI_API_KEY',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: [
      { model: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', costPer1kInput: 0.00015, costPer1kOutput: 0.0006, description: 'Fast and cost-effective' },
      { model: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', costPer1kInput: 0.00125, costPer1kOutput: 0.005, description: 'Most capable Gemini' },
      { model: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', costPer1kInput: 0.0001, costPer1kOutput: 0.0004, description: 'Previous generation flash' }
    ]
  },
  Groq: {
    keyEnv: 'GROQ_API_KEY',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { model: 'openai/gpt-oss-120b', displayName: 'GPT OSS 120B', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Open-source GPT 120B on Groq' },
      { model: 'openai/gpt-oss-20b', displayName: 'GPT OSS 20B', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Open-source GPT 20B on Groq' },
      { model: 'moonshotai/kimi-k2-instruct', displayName: 'Kimi K2', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Kimi K2 instruction model' },
      { model: 'meta-llama/llama-4-scout-17b-16e-instruct', displayName: 'Llama 4 Scout', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Llama 4 Scout 17B' },
      { model: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', costPer1kInput: 0.00059, costPer1kOutput: 0.00079, description: 'Llama 3.3 70B versatile' }
    ]
  }
};

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
    model: 'claude-3-haiku-20240307',
    costPer1kTokens: 0.00025, // $0.25 per 1M input tokens
    priority: 3,
    description: 'Fast and cost-effective'
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
    model: 'gemini-2.5-flash',
    costPer1kTokens: 0.0001, // $0.0001 per 1k tokens
    priority: 5,
    description: 'Google\'s offering, fast and cost-effective'
  },
  {
    name: 'Groq',
    model: 'llama-3.3-70b-versatile',
    costPer1kTokens: 0.00069, // Average of input/output pricing
    priority: 6,
    description: 'Ultra-fast inference on Groq LPU - Llama 3.3 70B'
  },
  {
    name: 'Groq',
    model: 'openai/gpt-oss-120b',
    costPer1kTokens: 0.0,
    priority: 7,
    description: 'Open-source GPT 120B on Groq'
  },
  {
    name: 'Groq',
    model: 'openai/gpt-oss-20b',
    costPer1kTokens: 0.0,
    priority: 8,
    description: 'Open-source GPT 20B on Groq'
  },
  {
    name: 'Groq',
    model: 'moonshotai/kimi-k2-instruct',
    costPer1kTokens: 0.0,
    priority: 9,
    description: 'Kimi K2 instruction model on Groq'
  },
  {
    name: 'Groq',
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    costPer1kTokens: 0.0,
    priority: 10,
    description: 'Llama 4 Scout 17B on Groq'
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

// Endpoint timing buffer for performance monitoring (accessible via /api/endpoint-timings)
const endpointTimings = [];
const MAX_TIMING_ENTRIES = 500; // Increased from 100 to capture more history

// Step timer helper for profiling endpoint internals
class StepTimer {
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.steps = [];
        this.startTime = Date.now();
        this.lastStep = this.startTime;
    }
    
    step(name) {
        const now = Date.now();
        const duration = now - this.lastStep;
        this.steps.push({ name, duration, timestamp: new Date().toISOString() });
        this.lastStep = now;
        return duration;
    }
    
    getSteps() {
        return this.steps;
    }
    
    getTotalTime() {
        return Date.now() - this.startTime;
    }
}

// Debug logging helper - only logs when DEBUG_LOGGING env var is set
const DEBUG_LOGGING = process.env.DEBUG_LOGGING === 'true';
const debugLog = (...args) => { if (DEBUG_LOGGING) console.log(...args); };

// Request/Response timing middleware for debugging
app.use((req, res, next) => {
    const startTime = Date.now();
    const requestTimestamp = new Date().toISOString();
    
    // Skip logging for health checks to reduce noise
    const isHealthCheck = req.originalUrl === '/health' || req.originalUrl === '/api/health';
    
    if (!isHealthCheck) {
        debugLog(`[REQUEST] ${requestTimestamp} | ${req.method} ${req.originalUrl}`);
    }
    
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const responseTimestamp = new Date().toISOString();
        
        // Only log non-health-check responses, or slow responses (>5s), or errors
        if (!isHealthCheck || duration > 5000 || res.statusCode >= 400) {
            if (res.statusCode >= 400 || duration > 5000) {
                console.log(`[RESPONSE] ${responseTimestamp} | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`);
            } else {
                debugLog(`[RESPONSE] ${responseTimestamp} | ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Duration: ${duration}ms`);
            }
        }
        
        // Store timing data in buffer for the performance monitor
        endpointTimings.unshift({
            method: req.method,
            endpoint: req.originalUrl,
            status: res.statusCode,
            duration,
            requestTime: requestTimestamp,
            responseTime: responseTimestamp,
            steps: req.stepTimer?.getSteps() || []  // Include step timings if available
        });
        
        // Keep buffer size limited
        if (endpointTimings.length > MAX_TIMING_ENTRIES) {
            endpointTimings.pop();
        }
    });
    
    next();
});

// Apply middleware
// CORS will be configured later with specific options

// Configure helmet with proper Firebase exceptions
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            connectSrc: [
                "'self'",
                "https://*.googleapis.com",
                "https://*.gstatic.com",
                "https://identitytoolkit.googleapis.com",
                "https://securetoken.googleapis.com",
                "https://*.firebaseio.com",
                "https://*.cloudfunctions.net"
            ],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://*.googleapis.com", "https://*.gstatic.com"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:", "blob:"],
            fontSrc: ["'self'", "data:", "https:"],
            frameSrc: ["'self'", "https://*.firebaseapp.com"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

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

// Serve static files (but not for /api routes)
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        return next(); // Skip static file serving for API routes
    }
    express.static(__dirname)(req, res, next);
});

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

// --- 4. Add CORS headers to all responses (backup) ---
// This is redundant but ensures headers are set even if cors() middleware fails
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://iannouvel.github.io',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5500',
    'https://clerkyai.health'
  ];
  
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', corsOptions.methods.join(', '));
    res.header('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(', '));
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Max-Age', corsOptions.maxAge.toString());
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
    debugLog('[DEBUG] validateGitHubToken: Starting GitHub token validation...');
    
    if (!githubToken) {
        console.error('[ERROR] validateGitHubToken: GITHUB_TOKEN is not set!');
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
    debugLog('[DEBUG] validateGitHubToken: Token validation complete');
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

// Function to fetch condensed text from Firestore
async function fetchCondensedFile(guidelineFilename) {
    try {
        console.log(`[FETCH_CONDENSED] Fetching condensed text from Firestore for: ${guidelineFilename}`);
        
        // Generate guideline ID from filename (remove .pdf extension and convert to ID format)
        const guidelineId = guidelineFilename
            .replace('.html', '')
            .replace('.pdf', '')
            .toLowerCase()
            .replace(/[^a-z0-9\-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        // Try to fetch from main guidelines collection
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (guidelineDoc.exists) {
            const data = guidelineDoc.data();
            const condensedText = data.condensed || data.content;
            
            if (condensedText) {
                debugLog(`[FETCH_CONDENSED] Successfully fetched from Firestore (${condensedText.length} chars)`);
                return condensedText;
            }
        }
        
        // If not found, try the condensed collection
        const condensedDoc = await db.collection('condensed').doc(guidelineId).get();
        if (condensedDoc.exists) {
            const condensedText = condensedDoc.data().condensed;
            if (condensedText) {
                console.log(`[FETCH_CONDENSED] Successfully fetched from condensed collection (${condensedText.length} chars)`);
                return condensedText;
            }
        }
        
        throw new Error(`No condensed text found for ${guidelineFilename}`);
    } catch (error) {
        console.error('[FETCH_CONDENSED] Error fetching condensed text:', error.message);
        throw new Error('Failed to retrieve the condensed guideline');
    }
}

// Function to extract text from PDF buffer
async function extractTextFromPDF(pdfBuffer) {
    try {
        debugLog(`[PDF_EXTRACT] Starting PDF text extraction, buffer size: ${pdfBuffer.length}`);
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

// Function to fetch PDF from Firebase Storage (with GitHub fallback + upload)
async function fetchAndExtractPDFText(pdfFileName) {
    try {
        debugLog(`[FETCH_PDF] Fetching PDF from Firebase Storage: ${pdfFileName}`);
        
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const file = bucket.file(`pdfs/${pdfFileName}`);
        
        const [exists] = await file.exists();
        
        let buffer;
        
        if (!exists) {
            // PDF not in Firebase Storage - try to fetch from GitHub and upload
            console.log(`[FETCH_PDF] PDF not found in Firebase Storage, attempting GitHub fallback: ${pdfFileName}`);
            
            const githubUrl = `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(pdfFileName)}`;
            console.log(`[FETCH_PDF] Fetching from GitHub: ${githubUrl}`);
            
            try {
                const response = await axios.get(githubUrl, {
                    responseType: 'arraybuffer',
                    timeout: 30000,
                    headers: {
                        'User-Agent': 'Clerky-Server/1.0'
                    }
                });
                
                if (response.status !== 200) {
                    throw new Error(`GitHub returned status ${response.status}`);
                }
                
                buffer = Buffer.from(response.data);
                console.log(`[FETCH_PDF] Downloaded from GitHub, size: ${buffer.length} bytes`);
                
                // Upload to Firebase Storage for future use
                console.log(`[FETCH_PDF] Uploading to Firebase Storage for future use...`);
                try {
                    await file.save(buffer, {
                        metadata: {
                            contentType: 'application/pdf',
                            metadata: {
                                uploadedFrom: 'github-fallback',
                                uploadedAt: new Date().toISOString()
                            }
                        }
                    });
                    console.log(`[FETCH_PDF] Successfully uploaded ${pdfFileName} to Firebase Storage`);
                } catch (uploadError) {
                    console.error(`[FETCH_PDF] Failed to upload to Firebase Storage (will continue with extraction):`, uploadError.message);
                    // Continue anyway - we have the buffer
                }
                
            } catch (githubError) {
                console.error(`[FETCH_PDF] GitHub fallback failed:`, githubError.message);
                throw new Error(`PDF not found in Firebase Storage and GitHub fallback failed: ${pdfFileName}`);
            }
        } else {
            console.log(`[FETCH_PDF] Found PDF in Firebase Storage: ${pdfFileName}`);
            [buffer] = await file.download();
            debugLog(`[FETCH_PDF] Downloaded from Firebase Storage, size: ${buffer.length} bytes`);
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
            debugLog(`[CONDENSE] Successfully condensed text: ${fullText.length} -> ${condensedText.length} characters`);
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

// Helper function to normalize American spellings to British (UK medical guidelines use British)
function normalizeAmericanToBritish(text) {
    if (!text) return '';
    
    const americanToBritish = {
        'sulfate': 'sulphate',
        'sulfur': 'sulphur',
        'anemia': 'anaemia',
        'anemic': 'anaemic',
        'anesthesia': 'anaesthesia',
        'anesthetic': 'anaesthetic',
        'cesarean': 'caesarean',
        'cesarian': 'caesarean',
        'edema': 'oedema',
        'esophagus': 'oesophagus',
        'estrogen': 'oestrogen',
        'fetus': 'foetus',
        'fetal': 'foetal',
        'gynecology': 'gynaecology',
        'gynecological': 'gynaecological',
        'hemoglobin': 'haemoglobin',
        'hemorrhage': 'haemorrhage',
        'hemorrhagic': 'haemorrhagic',
        'hemolytic': 'haemolytic',
        'pediatric': 'paediatric',
        'pediatrics': 'paediatrics',
        'labor': 'labour',
        'tumor': 'tumour',
        'fiber': 'fibre',
        'liter': 'litre',
        'meter': 'metre',
        'center': 'centre',
        'color': 'colour',
        'behavior': 'behaviour',
        'leukemia': 'leukaemia',
        'diarrhea': 'diarrhoea',
        'maneuver': 'manoeuvre',
        'orthopedic': 'orthopaedic'
    };
    
    let normalized = text;
    for (const [american, british] of Object.entries(americanToBritish)) {
        // Case-insensitive replace, preserving first letter case
        const regex = new RegExp(american, 'gi');
        normalized = normalized.replace(regex, match => {
            if (match[0] === match[0].toUpperCase()) {
                return british.charAt(0).toUpperCase() + british.slice(1);
            }
            return british;
        });
    }
    
    return normalized;
}

// Heuristic fallback: try to extract a short, verbatim snippet from the guideline text
// when the AI quote finder cannot find a direct match.
// This is designed to improve PDF search by anchoring on distinctive numeric tokens
// (e.g. gestational age ranges like 30+0 – 33+6) and nearby keywords.
function heuristicExtractQuoteFromGuidelineText(guidelineText, paraphrasedStatement) {
    try {
        const source = String(guidelineText || '');
        const statement = String(paraphrasedStatement || '').toLowerCase();
        if (!source.trim() || !statement.trim()) return null;

        const numericTokens = Array.from(new Set(statement.match(/\d+\+\d+/g) || []));

        // A small stopword list to keep keyword scoring useful without heavy NLP.
        const stopwords = new Set([
            'the','and','with','that','this','from','into','then','than','when','where','which',
            'should','could','would','must','may','might','will','can','also','only','within',
            'between','before','after','during','offer','offered','consider','considered','discuss','discussed'
        ]);

        const keywords = Array.from(
            new Set(
                statement
                    .split(/[^a-z0-9+]+/g)
                    .filter(w => w.length >= 5 && !stopwords.has(w))
            )
        );

        const looksLikeHeading = (line) => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            // Headings are often short, contain dashes, and contain no digits.
            const hasDigits = /\d/.test(trimmed);
            const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
            const hasDash = /[–—-]/.test(trimmed);
            const hasSentencePunct = /[.]/.test(trimmed);
            if (!hasDigits && wordCount <= 10 && hasDash && !hasSentencePunct) return true;
            return false;
        };

        const normalizeLineForMatch = (line) =>
            String(line || '')
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase();

        const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

        let best = null;
        let bestScore = 0;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.length < 10) continue;
            if (looksLikeHeading(line)) continue;

            const nLine = normalizeLineForMatch(line);

            // Must match at least one numeric token if any exist in the statement.
            if (numericTokens.length > 0) {
                const numericMatches = numericTokens.filter(t => nLine.includes(t)).length;
                if (numericMatches === 0) continue;
            }

            let score = 0;
            for (const t of numericTokens) {
                if (nLine.includes(t)) score += 20;
            }
            for (const kw of keywords) {
                if (kw && nLine.includes(kw)) score += 2;
            }

            // Prefer guideline-style "range – action" lines by rewarding dashes/bullets.
            if (/[–—-]/.test(line)) score += 2;
            if (/^\s*[-*•]\s+/.test(rawLine)) score += 1;

            if (score > bestScore) {
                bestScore = score;
                best = line;
            }
        }

        if (!best || bestScore <= 0) return null;

        // Clean bullet markers and normalise whitespace (still verbatim words).
        let cleaned = best.replace(/^\s*[-*•]\s+/, '').replace(/\s+/g, ' ').trim();

        // Enforce 5–25 words window; if too long, crop around the first numeric token.
        const words = cleaned.split(/\s+/).filter(Boolean);
        if (words.length < 5) return null;
        if (words.length > 25) {
            if (numericTokens.length > 0) {
                const firstToken = numericTokens[0];
                const idx = words.findIndex(w => w.includes(firstToken));
                if (idx >= 0) {
                    const start = Math.max(0, idx - 6);
                    const end = Math.min(words.length, start + 25);
                    cleaned = words.slice(start, end).join(' ');
                } else {
                    cleaned = words.slice(0, 25).join(' ');
                }
            } else {
                cleaned = words.slice(0, 25).join(' ');
            }
        }

        return cleaned;
    } catch (e) {
        console.warn('[QUOTE_FINDER] Heuristic extract failed', { error: e?.message });
        return null;
    }
}

// Attempt to "snap" an AI-produced quote to the exact substring in the extracted guideline text.
// This helps when the model returns the correct words but with different whitespace/dash characters
// than the PDF extractor produced.
function findVerbatimSubstringInGuidelineText(guidelineText, aiQuote) {
    const sourceText = String(guidelineText || '');
    let quote = String(aiQuote || '').trim();
    if (!sourceText.trim() || !quote) return null;

    // Build a tolerant regex:
    // - whitespace becomes \s+
    // - hyphen/en-dash/em-dash become a dash character class
    // - plus sign allows optional surrounding whitespace (30+0 vs 30 +0)
    const toTokenPattern = (token) => {
        if (!token) return '';
        let t = token;
        t = t.replace(/\+/g, '__PLUS__');
        t = t.replace(/[–—-]/g, '__DASH__');
        // Escape regex special chars
        t = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Re-inject placeholders as tolerant patterns
        t = t.replace(/__PLUS__/g, '\\s*\\+\\s*');
        t = t.replace(/__DASH__/g, '[\\-–—]');
        return t;
    };

    // Normalise fancy quotes to plain equivalents for matching (without modifying return value).
    quote = quote
        .replace(/[“”]/g, '"')
        .replace(/[‘’]/g, "'")
        .replace(/\u00A0/g, ' '); // NBSP

    const tokens = quote.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;

    const pattern = tokens.map(toTokenPattern).join('\\s+');

    try {
        const re = new RegExp(pattern, 'i');
        const match = sourceText.match(re);
        if (!match || !match[0]) return null;
        return String(match[0]).trim();
    } catch (e) {
        console.warn('[QUOTE_FINDER] Failed to build/use quote snapping regex', { error: e?.message });
        return null;
    }
}

// Function to find a short verbatim quote in a guideline that best matches a semantic statement
async function findGuidelineQuoteInText(guidelineId, semanticStatement, guidelineText, userId = null) {
    try {
        if (!guidelineText || !guidelineText.trim()) {
            console.warn(`[QUOTE_FINDER] No guideline text available for ${guidelineId}, cannot find quote`);
            return null;
        }

        // Pass the full guideline text to ensure verbatim quotes can be found
        // Most guidelines are under 50k chars which fits within modern LLM context windows
        let sourceText = String(guidelineText);

        const systemPrompt = `
You are a careful clinical guideline assistant tasked with finding SPECIFIC verbatim quotes.

You are given:
- A clinical guideline.
- A statement paraphrased from the guideline.

Your task:
- Find the most appropriate SHORT verbatim quote (5–25 words) from the guideline that DIRECTLY supports the statement.
- Please return only verbatim guideline text.

IMPORTANT CONTEXT:
- The statement may have VERY different grammar/word order to the guideline (because it is paraphrased).
- The guideline may have unusual formatting: bullet points, line breaks, headings, en-dashes (–), em-dashes (—), hyphens (-), and spacing differences (e.g. "30 +0" vs "30+0").
- Despite these differences, you must return ONLY text that exists verbatim in the guideline.

Example (what we mean by “different grammar/formatting”):
- Statement (paraphrased): "Consider neuroprotection between 30+0 and 33+6 weeks, discuss individually at 23+0–23+6."
- Guideline text might be formatted like:
  "When preterm birth is planned or expected within 24 hours, Magnesium Sulfate for neuroprotection should be:
   - 23+0 – 23+6 weeks - Discussed with the pregnant woman or person ...
   - 24+0 – 29+6 weeks – Offered.
   - 30+0 – 33+6 weeks – Considered"

IMPORTANT - DO NOT return:
- Section headings, titles, or headers (e.g., "Intravenous hydralazine – Third Line Treatment")
- Table headers or labels
- Generic phrases that are merely "relevant" but don't contain the specific advice

If you genuinely cannot find a matching quote with the specific content, respond with exactly: NO_MATCH

Output:
- Return ONLY the verbatim quote text, with no explanations, no quotation marks, and no additional formatting.
- Or respond with exactly NO_MATCH if no suitable quote exists.
`.trim();

        const userPrompt = `
Guideline ID: ${guidelineId}

Semantic statement (from previous answer):
${semanticStatement}

Guideline text (for searching a verbatim quote):
${sourceText}
`.trim();

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        console.log('[QUOTE_FINDER] Requesting verbatim quote from AI', {
            guidelineId,
            semanticLength: semanticStatement.length,
            textLength: sourceText.length
        });

        const aiResult = await routeToAI({ messages, temperature: 0.1 }, userId);

        if (!aiResult || !aiResult.content) {
            console.warn('[QUOTE_FINDER] AI returned no quote', { guidelineId });
            return null;
        }

        let quote = aiResult.content.trim();

        // Strip surrounding quotes if the model added them
        if ((quote.startsWith('"') && quote.endsWith('"')) || (quote.startsWith("'") && quote.endsWith("'"))) {
            quote = quote.slice(1, -1).trim();
        }

        // Check if AI explicitly said no match was found
        if (quote.toUpperCase() === 'NO_MATCH' || quote.toUpperCase().includes('NO_MATCH')) {
            debugLog('[QUOTE_FINDER] AI reported no matching quote found', { guidelineId });
            const heuristic = heuristicExtractQuoteFromGuidelineText(sourceText, semanticStatement);
            if (heuristic) {
                console.log('[QUOTE_FINDER] Using heuristic extracted quote after NO_MATCH', {
                    guidelineId,
                    quoteSample: heuristic.substring(0, 80)
                });
                return heuristic;
            }
            return null;
        }

        // Basic sanity checks
        if (!quote || quote.length < 5) {
            console.warn('[QUOTE_FINDER] Quote too short, falling back to semantic statement', {
                guidelineId,
                quote
            });
            const heuristic = heuristicExtractQuoteFromGuidelineText(sourceText, semanticStatement);
            if (heuristic) {
                debugLog('[QUOTE_FINDER] Using heuristic extracted quote after short quote', {
                    guidelineId,
                    quoteSample: heuristic.substring(0, 80)
                });
                return heuristic;
            }
            return null;
        }

        // Ensure the quote appears somewhere in the guideline text (case-insensitive)
        const lowerSource = sourceText.toLowerCase();
        const lowerQuote = quote.toLowerCase();
        
        // Try exact match first
        let foundMatch = lowerSource.includes(lowerQuote);
        
        // If no exact match, try with British spelling normalization
        // (UK guidelines use British spellings but AI often uses American)
        if (!foundMatch) {
            const britishQuote = normalizeAmericanToBritish(quote).toLowerCase();
            if (britishQuote !== lowerQuote && lowerSource.includes(britishQuote)) {
                console.log('[QUOTE_FINDER] Quote found after British spelling normalization', {
                    guidelineId,
                    original: quote.substring(0, 50),
                    normalized: normalizeAmericanToBritish(quote).substring(0, 50)
                });
                // Snap to exact extracted substring if possible (preserves exact PDF extraction punctuation)
                const snapped = findVerbatimSubstringInGuidelineText(sourceText, normalizeAmericanToBritish(quote));
                if (snapped) return snapped;
                // Otherwise, return the British-normalised version (better chance of matching PDF)
                return normalizeAmericanToBritish(quote);
            }
        }
        
        // If still no match, try with whitespace normalization
        // PDF extraction often has different whitespace around special characters
        // e.g., "24 +0" in PDF vs "24+0" in AI-generated quote
        if (!foundMatch) {
            const normalizeWhitespace = (text) => text
                .replace(/\s+/g, ' ')  // Collapse multiple spaces
                .replace(/\s*([+\-*/=<>()[\]{}])\s*/g, ' $1 ')  // Normalize spaces around operators/brackets
                .replace(/\s+/g, ' ')  // Collapse again after normalization
                .trim();
            
            const normalizedSource = normalizeWhitespace(lowerSource);
            const normalizedQuote = normalizeWhitespace(lowerQuote);
            
            if (normalizedSource.includes(normalizedQuote)) {
                debugLog('[QUOTE_FINDER] Quote found after whitespace normalization', {
                    guidelineId,
                    original: quote.substring(0, 50),
                    normalizedQuote: normalizedQuote.substring(0, 50)
                });
                foundMatch = true;
            }
        }
        
        if (!foundMatch) {
            console.warn('[QUOTE_FINDER] Quote not found verbatim in guideline text, using semantic statement instead', {
                guidelineId,
                quoteSample: quote.substring(0, 80)
            });
            // As a last attempt, try to snap the quote to an exact substring using tolerant matching.
            const snapped = findVerbatimSubstringInGuidelineText(sourceText, quote);
            if (snapped) {
                console.log('[QUOTE_FINDER] Snapped AI quote to extracted guideline substring', {
                    guidelineId,
                    quoteSample: snapped.substring(0, 80)
                });
                return snapped;
            }
            const heuristic = heuristicExtractQuoteFromGuidelineText(sourceText, semanticStatement);
            if (heuristic) {
                debugLog('[QUOTE_FINDER] Using heuristic extracted quote after mismatch', {
                    guidelineId,
                    quoteSample: heuristic.substring(0, 80)
                });
                return heuristic;
            }
            return null;
        }

        // We found a match by some means; prefer returning the exact substring from extracted text if we can.
        const snapped = findVerbatimSubstringInGuidelineText(sourceText, quote);
        if (snapped) {
            console.log('[QUOTE_FINDER] Snapped matching quote to extracted guideline substring', {
                guidelineId,
                quoteSample: snapped.substring(0, 80)
            });
            quote = snapped;
        }

        debugLog('[QUOTE_FINDER] Successfully found verbatim quote', {
            guidelineId,
            quoteSample: quote.substring(0, 80)
        });

        return quote;
    } catch (error) {
        console.error('[QUOTE_FINDER] Error during quote search', {
            guidelineId,
            error: error.message
        });
        return null;
    }
}

// Function to generate summary from content using AI
async function generateSummary(text, userId = null) {
    try {
        console.log(`[SUMMARY] Starting summary generation, input length: ${text.length}`);
        
        const prompt = `Please provide a concise summary of this clinical guideline in 2-3 paragraphs. Focus on the key recommendations, target population, and main clinical actions. Make it suitable for quick reference by healthcare professionals.

Clinical guideline text:
${text.substring(0, 8000)}`; // Limit input to avoid token limits

        const messages = [
            { 
                role: 'system', 
                content: 'You are a medical expert creating concise summaries of clinical guidelines for healthcare professionals.' 
            },
            { role: 'user', content: prompt }
        ];
        
        const aiResult = await sendToAI(messages, 'deepseek-chat', null, userId);
        
        if (aiResult && aiResult.content) {
            const summary = aiResult.content.trim();
            debugLog(`[SUMMARY] Successfully generated summary: ${summary.length} characters`);
            return summary;
        } else {
            console.warn(`[SUMMARY] AI did not return summary`);
            return null;
        }
        
    } catch (error) {
        console.error(`[SUMMARY] Error generating summary:`, error);
        return null;
    }
}

// Function to extract significant terms from content using AI
async function extractSignificantTerms(text, userId = null) {
    try {
        debugLog(`[TERMS] Starting term extraction, input length: ${text.length}`);
        
        const prompt = `Extract the most significant medical terms, conditions, procedures, and medications from this clinical guideline. Return them as a JSON array of objects with "term" and "category" fields. Categories should be: condition, procedure, medication, test, or general.

Clinical guideline text:
${text.substring(0, 6000)}`;

        const messages = [
            { 
                role: 'system', 
                content: 'You are a medical terminology expert. Extract key medical terms and categorize them. Return only valid JSON.' 
            },
            { role: 'user', content: prompt }
        ];
        
        const aiResult = await sendToAI(messages, 'deepseek-chat', null, userId);
        
        if (aiResult && aiResult.content) {
            // Try to parse JSON from response
            try {
                const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const terms = JSON.parse(jsonMatch[0]);
                    debugLog(`[TERMS] Successfully extracted ${terms.length} terms`);
                    return terms;
                }
            } catch (parseError) {
                console.warn(`[TERMS] Failed to parse JSON, returning raw text`);
            }
            return [];
        } else {
            console.warn(`[TERMS] AI did not return terms`);
            return [];
        }
        
    } catch (error) {
        console.error(`[TERMS] Error extracting terms:`, error);
        return [];
    }
}

// Function to extract auditable elements from content using AI
async function extractAuditableElements(text, userId = null) {
    try {
        console.log(`[AUDITABLE] Starting auditable element extraction, input length: ${text.length}`);
        
        const prompt = `Extract key clinical recommendations and auditable elements from this guideline. Focus on specific clinical actions, thresholds, timeframes, and measurable outcomes. Return as a JSON array of objects with "element", "description", and "measurable" (boolean) fields.

Clinical guideline text:
${text.substring(0, 6000)}`;

        const messages = [
            { 
                role: 'system', 
                content: 'You are a clinical audit expert. Extract measurable clinical recommendations and key decision points. Return only valid JSON.' 
            },
            { role: 'user', content: prompt }
        ];
        
        const aiResult = await sendToAI(messages, 'deepseek-chat', null, userId);
        
        if (aiResult && aiResult.content) {
            // Try to parse JSON from response
            try {
                const jsonMatch = aiResult.content.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const elements = JSON.parse(jsonMatch[0]);
                    debugLog(`[AUDITABLE] Successfully extracted ${elements.length} auditable elements`);
                    return elements;
                }
            } catch (parseError) {
                console.warn(`[AUDITABLE] Failed to parse JSON, returning empty array`);
            }
            return [];
        } else {
            console.warn(`[AUDITABLE] AI did not return auditable elements`);
            return [];
        }
        
    } catch (error) {
        console.error(`[AUDITABLE] Error extracting auditable elements:`, error);
        return [];
    }
}

// ============================================================================
// BACKGROUND JOB QUEUE SYSTEM
// ============================================================================

const jobQueue = [];
const processingJobs = new Set();
const MAX_CONCURRENT_JOBS = 3;
let isProcessingQueue = false;

// Add job to queue
function queueJob(jobType, guidelineId, data = {}) {
    const job = {
        id: `${jobType}-${guidelineId}-${Date.now()}`,
        type: jobType,
        guidelineId: guidelineId,
        data: data,
        status: 'pending',
        createdAt: new Date().toISOString(),
        attempts: 0,
        maxAttempts: 3,
        error: null
    };
    
    jobQueue.push(job);
    console.log(`[JOB_QUEUE] Added job: ${job.id}, queue length: ${jobQueue.length}`);
    
    // Start processing if not already running
    if (!isProcessingQueue) {
        processJobQueue();
    }
    
    return job.id;
}

// Process job queue
async function processJobQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    
    debugLog(`[JOB_QUEUE] Starting queue processor, ${jobQueue.length} jobs pending`);
    
    while (jobQueue.length > 0) {
        // Wait if we're at max concurrent jobs
        while (processingJobs.size >= MAX_CONCURRENT_JOBS) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        const job = jobQueue.shift();
        if (!job) continue;
        
        processingJobs.add(job.id);
        
        // Process job asynchronously
        processJob(job).then(() => {
            processingJobs.delete(job.id);
        }).catch((error) => {
            console.error(`[JOB_QUEUE] Job ${job.id} failed:`, error);
            processingJobs.delete(job.id);
        });
        
        // Small delay between job starts
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Wait for all jobs to complete
    while (processingJobs.size > 0) {
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    isProcessingQueue = false;
    console.log(`[JOB_QUEUE] Queue processor stopped, all jobs completed`);
}

// Process individual job
async function processJob(job) {
    debugLog(`[JOB_QUEUE] Processing job: ${job.id}, type: ${job.type}`);
    
    try {
        job.attempts++;
        job.status = 'processing';
        
        const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
        const doc = await guidelineRef.get();
        
        if (!doc.exists) {
            throw new Error(`Guideline not found: ${job.guidelineId}`);
        }
        
        const guidelineData = doc.data();
        let result;
        
        switch (job.type) {
            case 'extract_content':
                result = await jobExtractContent(job, guidelineData);
                break;
            case 'generate_condensed':
                result = await jobGenerateCondensed(job, guidelineData);
                break;
            case 'generate_summary':
                result = await jobGenerateSummary(job, guidelineData);
                break;
            case 'extract_terms':
                result = await jobExtractTerms(job, guidelineData);
                break;
            case 'extract_auditable':
                result = await jobExtractAuditable(job, guidelineData);
                break;
            case 'generate_display_name':
                result = await jobGenerateDisplayName(job, guidelineData);
                break;
            default:
                throw new Error(`Unknown job type: ${job.type}`);
        }
        
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        console.log(`[JOB_QUEUE] Job completed: ${job.id}`);
        
        return result;
        
    } catch (error) {
        console.error(`[JOB_QUEUE] Job ${job.id} error:`, error.message);
        
        job.error = error.message;
        
        // Retry if not at max attempts
        if (job.attempts < job.maxAttempts) {
            debugLog(`[JOB_QUEUE] Retrying job ${job.id}, attempt ${job.attempts}/${job.maxAttempts}`);
            job.status = 'pending';
            jobQueue.push(job); // Re-queue
        } else {
            console.error(`[JOB_QUEUE] Job ${job.id} failed after ${job.attempts} attempts`);
            job.status = 'failed';
            
            // Update Firestore with error
            try {
                const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
                await guidelineRef.update({
                    [`processingErrors.${job.type}`]: error.message,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
            } catch (updateError) {
                console.error(`[JOB_QUEUE] Failed to update error in Firestore:`, updateError);
            }
        }
        
        throw error;
    }
}

// Job handlers
async function jobExtractContent(job, guidelineData) {
    const filename = guidelineData.filename || guidelineData.originalFilename;
    if (!filename) throw new Error('No filename found');
    
    const fullText = await fetchAndExtractPDFText(filename);
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        content: fullText,
        'processingStatus.contentExtracted': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Queue displayName generation now that content is available
    queueJob('generate_display_name', job.guidelineId);
    
    return { contentLength: fullText.length };
}

async function jobGenerateCondensed(job, guidelineData) {
    const content = guidelineData.content;
    if (!content) throw new Error('No content to condense');
    
    const condensed = await generateCondensedText(content, 'system');
    if (!condensed) throw new Error('Failed to generate condensed text');
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        condensed: condensed,
        'processingStatus.condensedGenerated': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Also save to condensed collection
    const condensedRef = db.collection('condensed').doc(job.guidelineId);
    await condensedRef.set({
        condensed: condensed,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        generatedDate: new Date().toISOString(),
        sourceType: 'background_job'
    });
    
    return { condensedLength: condensed.length };
}

async function jobGenerateSummary(job, guidelineData) {
    const content = guidelineData.condensed || guidelineData.content;
    if (!content) throw new Error('No content to summarize');
    
    const summary = await generateSummary(content, 'system');
    if (!summary) throw new Error('Failed to generate summary');
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        summary: summary,
        'processingStatus.summaryGenerated': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { summaryLength: summary.length };
}

async function jobExtractTerms(job, guidelineData) {
    const content = guidelineData.content;
    if (!content) throw new Error('No content to extract terms from');
    
    const terms = await extractSignificantTerms(content, 'system');
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        significantTerms: terms,
        'processingStatus.termsExtracted': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    return { termsCount: terms.length };
}

async function jobExtractAuditable(job, guidelineData) {
    const content = guidelineData.condensed || guidelineData.content;
    if (!content) throw new Error('No content to extract auditable elements from');
    
    const elements = await extractAuditableElements(content, 'system');
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        auditableElements: elements,
        'processingStatus.auditableExtracted': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Check if all processing is complete
    await checkAndMarkProcessingComplete(job.guidelineId);
    
    return { elementsCount: elements.length };
}

async function jobGenerateDisplayName(job, guidelineData) {
    // Wait for content to be available (either condensed or content)
    const content = guidelineData.condensed || guidelineData.content;
    if (!content) {
        // If no content yet, skip and let it retry later
        throw new Error('No content available yet for displayName generation');
    }
    
    // Use system user ID for background jobs
    const userId = 'system';
    const displayName = await generateDisplayNameWithAI(guidelineData, userId);
    
    if (!displayName) {
        // If AI generation fails, keep the existing rule-based one
        console.log(`[JOB_DISPLAY_NAME] AI generation failed for ${job.guidelineId}, keeping existing displayName`);
        return { skipped: true, reason: 'AI generation failed' };
    }
    
    const guidelineRef = db.collection('guidelines').doc(job.guidelineId);
    await guidelineRef.update({
        displayName: displayName,
        'processingStatus.displayNameGenerated': true,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    });
    
    debugLog(`[JOB_DISPLAY_NAME] Updated displayName for ${job.guidelineId}: "${displayName}"`);
    return { displayName: displayName };
}

// Check if all processing steps are complete and update flag
async function checkAndMarkProcessingComplete(guidelineId) {
    try {
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const doc = await guidelineRef.get();
        
        if (!doc.exists) return;
        
        const data = doc.data();
        const status = data.processingStatus || {};
        
        const allComplete = 
            status.contentExtracted &&
            status.condensedGenerated &&
            status.summaryGenerated &&
            status.termsExtracted &&
            status.auditableExtracted;
        
        if (allComplete && data.processing) {
            console.log(`[PROCESSING_COMPLETE] All processing complete for: ${guidelineId}`);
            await guidelineRef.update({
                processing: false,
                processed: true,
                processingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
        }
    } catch (error) {
        console.error(`[CHECK_COMPLETE] Error checking completion status:`, error);
    }
}

// Routine background scanner for incomplete guidelines
async function scanAndProcessIncompleteGuidelines() {
    try {
        debugLog('[BACKGROUND_SCAN] Starting scan for incomplete guidelines...');
        
        const snapshot = await db.collection('guidelines').get();
        let incomplete_count = 0;
        let already_processing = 0;
        
        for (const doc of snapshot.docs) {
            const guidelineId = doc.id;
            const data = doc.data();
            
            // Skip if already processing
            if (data.processing) {
                already_processing++;
                continue;
            }
            
            // Check for missing content
            const needsProcessing = 
                !data.content ||
                !data.condensed ||
                !data.summary ||
                !data.significantTerms ||
                !data.auditableElements;
            
            if (needsProcessing && data.filename) {
                console.log(`[BACKGROUND_SCAN] Found incomplete: ${guidelineId}, queueing jobs...`);
                
                // Queue missing jobs
                if (!data.content || !data.processingStatus?.contentExtracted) {
                    queueJob('extract_content', guidelineId);
                }
                if (!data.condensed || !data.processingStatus?.condensedGenerated) {
                    queueJob('generate_condensed', guidelineId);
                }
                if (!data.summary || !data.processingStatus?.summaryGenerated) {
                    queueJob('generate_summary', guidelineId);
                }
                if (!data.significantTerms || !data.processingStatus?.termsExtracted) {
                    queueJob('extract_terms', guidelineId);
                }
                if (!data.auditableElements || !data.processingStatus?.auditableExtracted) {
                    queueJob('extract_auditable', guidelineId);
                }
                
                // Mark as processing
                await doc.ref.update({
                    processing: true,
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                });
                
                incomplete_count++;
                
                // Limit batch size to avoid overwhelming system
                if (incomplete_count >= 20) {
                    debugLog('[BACKGROUND_SCAN] Reached batch limit (20), will continue in next scan');
                    break;
                }
            }
        }
        
        console.log(`[BACKGROUND_SCAN] Scan complete: ${incomplete_count} queued, ${already_processing} already processing`);
        
    } catch (error) {
        console.error('[BACKGROUND_SCAN] Error during scan:', error);
    }
}

// Schedule routine background scans
let backgroundScanInterval;
function startBackgroundScanner() {
    console.log('[BACKGROUND_SCAN] Starting routine background scanner...');
    
    // Run immediately on startup
    setTimeout(() => {
        scanAndProcessIncompleteGuidelines();
    }, 30000); // 30 seconds after startup
    
    // Then run every 10 minutes
    backgroundScanInterval = setInterval(() => {
        scanAndProcessIncompleteGuidelines();
    }, 10 * 60 * 1000); // 10 minutes
    
    debugLog('[BACKGROUND_SCAN] Scanner scheduled: runs every 10 minutes');
}

// ============================================================================
// FIREBASE STORAGE HELPERS FOR LARGE CONTENT
// ============================================================================

/**
 * Upload large text content to Firebase Storage
 * @param {string} content - The text content to upload
 * @param {string} guidelineId - The guideline ID for file naming
 * @param {string} type - Content type ('content', 'condensed', 'summary')
 * @returns {Promise<string>} - The public URL of the uploaded file
 */
async function uploadContentToStorage(content, guidelineId, type = 'content') {
    try {
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const fileName = `guideline-content/${guidelineId}/${type}.txt`;
        const file = bucket.file(fileName);
        
        console.log(`[STORAGE] Uploading ${type} for ${guidelineId} to Storage (${content.length} bytes)`);
        
        // Upload the content
        await file.save(content, {
            contentType: 'text/plain',
            metadata: {
                cacheControl: 'public, max-age=31536000', // Cache for 1 year
                metadata: {
                    guidelineId: guidelineId,
                    contentType: type,
                    uploadedAt: new Date().toISOString()
                }
            }
        });
        
        // Make the file publicly readable
        await file.makePublic();
        
        // Get the public URL
        const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
        debugLog(`[STORAGE] Successfully uploaded ${type}`);
        
        return publicUrl;
    } catch (error) {
        console.error(`[STORAGE] Error uploading ${type} for ${guidelineId}:`, error.message);
        throw error;
    }
}

/**
 * Check if content is too large for Firestore (>800KB to be safe, limit is 1MB)
 * @param {string} content - The content to check
 * @returns {boolean} - True if content is too large
 */
function isContentTooLarge(content) {
    if (!content) return false;
    const sizeInBytes = Buffer.byteLength(content, 'utf8');
    const maxSize = 800 * 1024; // 800KB to leave room for other fields
    return sizeInBytes > maxSize;
}

/**
 * Prepare content for Firestore storage, using Storage for large content
 * @param {string} content - The full content
 * @param {string} condensed - The condensed content
 * @param {string} summary - The summary
 * @param {string} guidelineId - The guideline ID
 * @returns {Promise<Object>} - Object with content fields ready for Firestore
 */
async function prepareContentForFirestore(content, condensed, summary, guidelineId) {
    const result = {
        content: content,
        condensed: condensed,
        summary: summary,
        contentStorageUrl: null,
        condensedStorageUrl: null,
        summaryStorageUrl: null,
        contentInStorage: false
    };
    
    try {
        // Calculate sizes
        const contentSize = content ? Buffer.byteLength(content, 'utf8') : 0;
        const condensedSize = condensed ? Buffer.byteLength(condensed, 'utf8') : 0;
        const summarySize = summary ? Buffer.byteLength(summary, 'utf8') : 0;
        const totalSize = contentSize + condensedSize + summarySize;
        
        // Debug logging - consolidated to reduce noise
        debugLog(`[STORAGE] prepareContentForFirestore: ${guidelineId}, total: ${totalSize} bytes`);
        
        // If total size exceeds 900KB (leaving 124KB for metadata), move largest fields to Storage
        // Firestore limit is 1MB (1,048,576 bytes) total for the entire document
        const SAFE_TOTAL_LIMIT = 900 * 1024; // 900KB to leave room for metadata
        
        if (totalSize > SAFE_TOTAL_LIMIT) {
            debugLog(`[STORAGE] Moving large content to Storage for ${guidelineId}`);
            
            // Move content to Storage if it exists and is significant
            if (content && contentSize > 100 * 1024) { // >100KB
                result.contentStorageUrl = await uploadContentToStorage(content, guidelineId, 'content');
                result.content = null;
                result.contentInStorage = true;
            }
            
            // Move condensed to Storage if it exists and is significant
            if (condensed && condensedSize > 100 * 1024) { // >100KB
                result.condensedStorageUrl = await uploadContentToStorage(condensed, guidelineId, 'condensed');
                result.condensed = null;
            }
            
            // Summary is usually small, but check if still over limit after moving content/condensed
            const remainingSize = (result.content ? contentSize : 0) + 
                                  (result.condensed ? condensedSize : 0) + 
                                  summarySize;
            if (remainingSize > SAFE_TOTAL_LIMIT && summary) {
                result.summaryStorageUrl = await uploadContentToStorage(summary, guidelineId, 'summary');
                result.summary = null;
            }
        }
        
        debugLog(`[STORAGE] Preparation complete for ${guidelineId}, using Storage: ${result.contentInStorage}`);
        return result;
    } catch (error) {
        console.error(`[STORAGE] Error preparing content for Firestore:`, error.message);
        console.error(`[STORAGE] Error stack:`, error.stack);
        // If storage upload fails, truncate content to fit in Firestore
        if (isContentTooLarge(content)) {
            console.warn(`[STORAGE] Storage upload failed, truncating content to fit Firestore`);
            result.content = content.substring(0, 700 * 1024) + '\n\n[Content truncated due to size limits]';
        }
        return result;
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
                    debugLog(`[CONTENT_GEN] Attempting to extract text from PDF: ${pdfFileName}`);
                    const extractedContent = await fetchAndExtractPDFText(pdfFileName);
                    
                    if (extractedContent && extractedContent.trim().length > 0) {
                        updates.content = extractedContent;
                        console.log(`[CONTENT_GEN] Successfully extracted content for ${guidelineId}: ${extractedContent.length} chars`);
                        updated = true;
                    } else {
                        debugLog(`[CONTENT_GEN] PDF extraction returned empty content for ${guidelineId}`);
                    }
                } else {
                    console.log(`[CONTENT_GEN] Could not determine PDF filename for ${guidelineId}`);
                }
            } catch (pdfError) {
                debugLog(`[CONTENT_GEN] PDF extraction failed for ${guidelineId}: ${pdfError.message}`);
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
                        
                        debugLog(`[CONTENT_GEN] Generated condensed text for ${guidelineId}: ${condensedText.length} chars`);
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
            
            await guidelineRef.set(updates, { merge: true });
            debugLog(`[CONTENT_GEN] Updated guideline ${guidelineId} with generated content`);
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
  debugLog('[DEBUG] Firebase: Processing private key...');
  let privateKey;
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    // Handle base64 encoded private key (preferred method for environment variables)
    debugLog('[DEBUG] Firebase: Using base64 encoded private key');
    try {
      privateKey = Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, 'base64').toString('utf8');
      debugLog('[DEBUG] Firebase: Successfully decoded base64 private key');
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
  debugLog('[DEBUG] Firebase: Testing private key validity...');
  try {
    const testMessage = 'test';
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(testMessage);
    sign.sign(privateKey); // This will throw if the key is invalid
    debugLog('[DEBUG] Firebase: Private key validation successful');
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
  
  debugLog('[DEBUG] Firebase: Initializing Firebase Admin SDK...');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: 'clerky-b3be8.firebasestorage.app'
  });
  
  debugLog('[DEBUG] Firebase: Firebase Admin SDK initialized successfully');
  
  // Initialize Firestore with additional error handling
  debugLog('[DEBUG] Firebase: Initializing Firestore...');
  db = admin.firestore();
  db.settings({
    ignoreUndefinedProperties: true,
    preferRest: true // Prefer REST API over gRPC
  });
  
  debugLog('[DEBUG] Firebase: Firestore instance created with REST API configuration');
  
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
  debugLog('[DEBUG] Firebase: Continuing without Firebase Firestore due to initialization error');
  debugLog('[DEBUG] Firebase: The application will work with limited functionality (no guideline persistence)');
  
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

    debugLog(`Attempting to get AI preference for user: ${userId}`);
    
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
                debugLog('User preference file exists');
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
            
            debugLog(`Successfully updated AI preference in local file for user: ${userId}`);
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

// Hospital Trust preference cache
const userHospitalTrustCache = new Map();

// Guideline Scope preference cache
const userGuidelineScopeCache = new Map();

// Model Preferences cache
const userModelPreferencesCache = new Map();

// Chunk distribution provider preferences cache
const userChunkDistributionProvidersCache = new Map();

// Get user's model preferences (ordered list)
async function getUserModelPreferences(userId) {
    // Check if we have a cached preference for this user
    if (userModelPreferencesCache.has(userId)) {
        const cachedData = userModelPreferencesCache.get(userId);
        // Check if the cached data is still valid
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            console.log(`Using cached model preferences for user ${userId}:`, cachedData.modelOrder);
            return cachedData.modelOrder;
        } else {
            // Cached data is expired, remove it
            userModelPreferencesCache.delete(userId);
        }
    }

    debugLog(`Attempting to get model preferences for user: ${userId}`);
    
    try {
        // Try Firestore first if available
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    console.log('User preference document exists in Firestore:', data);
                    
                    if (data && data.modelPreferences && Array.isArray(data.modelPreferences)) {
                        // Cache the preference
                        userModelPreferencesCache.set(userId, {
                            modelOrder: data.modelPreferences,
                            timestamp: Date.now()
                        });
                        return data.modelPreferences;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserModelPreferences, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                debugLog('User preference file exists');
                if (userData && userData.modelPreferences && Array.isArray(userData.modelPreferences)) {
                    // Cache the preference
                    userModelPreferencesCache.set(userId, {
                        modelOrder: userData.modelPreferences,
                        timestamp: Date.now()
                    });
                    return userData.modelPreferences;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }
        
        // Default to cost-ordered list if no preference found (use model ID as unique key)
        const defaultOrder = AI_PROVIDER_PREFERENCE.map(p => p.model);

        // Cache the default preference
        userModelPreferencesCache.set(userId, {
            modelOrder: defaultOrder,
            timestamp: Date.now()
        });

        return defaultOrder;
    } catch (error) {
        console.error('Critical error in getUserModelPreferences:', error);
        return AI_PROVIDER_PREFERENCE.map(p => p.model); // Default to cost-ordered list on error
    }
}

// Update user's model preferences (ordered list)
async function updateUserModelPreferences(userId, modelOrder) {
    console.log(`Updating model preferences for user ${userId} to:`, modelOrder);
    
    // Update cache immediately
    userModelPreferencesCache.set(userId, {
        modelOrder: modelOrder,
        timestamp: Date.now()
    });
    
    try {
        // Try to update in Firestore if available
        if (db) {
            try {
                // Get existing preferences to merge with them
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
                
                // Set the modelPreferences field
                const updateData = {
                    ...existingData,
                    modelPreferences: modelOrder,
                    updatedAt: new Date().toISOString()
                };
                await db.collection('userPreferences').doc(userId).set(updateData);
                
                debugLog(`Successfully updated model preferences in Firestore for user: ${userId}`);
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserModelPreferences, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        try {
            // Save to local JSON file
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            
            existingData.modelPreferences = modelOrder;
            existingData.updatedAt = new Date().toISOString();
            
            fs.writeFileSync(userPrefsFilePath, JSON.stringify(existingData, null, 2));
            
            console.log(`Successfully updated model preferences in local file for user: ${userId}`);
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserModelPreferences:', error);
        return false;
    }
}

// Get user's chunk distribution providers (allowed providers for chunked requests)
async function getUserChunkDistributionProviders(userId) {
    try {
        const cached = userChunkDistributionProvidersCache.get(userId);
        if (cached && (Date.now() - cached.timestamp) < (5 * 60 * 1000)) {
            return cached.providers;
        }

        const defaultProviders = AI_PROVIDER_PREFERENCE.map(p => p.name);

        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    if (data && Array.isArray(data.chunkDistributionProviders) && data.chunkDistributionProviders.length > 0) {
                        const providers = data.chunkDistributionProviders;
                        userChunkDistributionProvidersCache.set(userId, { providers, timestamp: Date.now() });
                        return providers;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserChunkDistributionProviders:', firestoreError);
            }
        }

        userChunkDistributionProvidersCache.set(userId, { providers: defaultProviders, timestamp: Date.now() });
        return defaultProviders;
    } catch (error) {
        console.error('Critical error in getUserChunkDistributionProviders:', error);
        return AI_PROVIDER_PREFERENCE.map(p => p.name);
    }
}

// Update user's chunk distribution providers
async function updateUserChunkDistributionProviders(userId, providers) {
    userChunkDistributionProvidersCache.set(userId, { providers, timestamp: Date.now() });

    try {
        if (db) {
            const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
            const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
            await db.collection('userPreferences').doc(userId).set({
                ...existingData,
                chunkDistributionProviders: providers,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        }
    } catch (error) {
        console.error('Error updating chunk distribution providers in Firestore:', error);
    }

    return false;
}

// Get user's hospital trust preference
async function getUserHospitalTrust(userId) {
    // Check if we have a cached preference for this user
    if (userHospitalTrustCache.has(userId)) {
        const cachedData = userHospitalTrustCache.get(userId);
        // Check if the cached data is still valid
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            debugLog(`Using cached hospital trust for user ${userId}: ${cachedData.hospitalTrust}`);
            return cachedData.hospitalTrust;
        } else {
            // Cached data is expired, remove it
            userHospitalTrustCache.delete(userId);
        }
    }

    debugLog(`Attempting to get hospital trust preference for user: ${userId}`);
    
    try {
        // Try Firestore first if available
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    console.log('User preference document exists in Firestore:', data);
                    
                    if (data && data.hospitalTrust) {
                        // Cache the preference
                        userHospitalTrustCache.set(userId, {
                            hospitalTrust: data.hospitalTrust,
                            timestamp: Date.now()
                        });
                        return data.hospitalTrust;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserHospitalTrust, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                debugLog('User preference file exists');
                if (userData && userData.hospitalTrust) {
                    // Cache the preference
                    userHospitalTrustCache.set(userId, {
                        hospitalTrust: userData.hospitalTrust,
                        timestamp: Date.now()
                    });
                    return userData.hospitalTrust;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }
        
        // No hospital trust set
        return null;
    } catch (error) {
        console.error('Critical error in getUserHospitalTrust:', error);
        return null;
    }
}

// Update user's hospital trust preference
async function updateUserHospitalTrust(userId, hospitalTrust) {
    console.log(`Updating hospital trust preference for user ${userId} to ${hospitalTrust}`);
    
    // Update cache immediately
    userHospitalTrustCache.set(userId, {
        hospitalTrust: hospitalTrust,
        timestamp: Date.now()
    });
    
    try {
        // Try to update in Firestore if available
        if (db) {
            try {
                // Get existing preferences to merge with them
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
                
                await db.collection('userPreferences').doc(userId).set({
                    ...existingData,
                    hospitalTrust: hospitalTrust,
                    region: 'England & Wales',
                    updatedAt: new Date().toISOString()
                });
                console.log(`Successfully updated hospital trust preference in Firestore for user: ${userId}`);
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserHospitalTrust, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        try {
            // Save to local JSON file
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            
            fs.writeFileSync(userPrefsFilePath, JSON.stringify({
                ...existingData,
                hospitalTrust: hospitalTrust,
                region: 'England & Wales',
                updatedAt: new Date().toISOString()
            }));
            
            debugLog(`Successfully updated hospital trust preference in local file for user: ${userId}`);
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserHospitalTrust:', error);
        return false;
    }
}

// Get user's guideline scope preference
async function getUserGuidelineScope(userId) {
    // Check if we have a cached preference for this user
    if (userGuidelineScopeCache.has(userId)) {
        const cachedData = userGuidelineScopeCache.get(userId);
        // Check if the cached data is still valid
        if (Date.now() - cachedData.timestamp < USER_PREFERENCE_CACHE_TTL) {
            debugLog(`Using cached guideline scope for user ${userId}:`, cachedData.guidelineScope);
            return cachedData.guidelineScope;
        } else {
            // Cached data is expired, remove it
            userGuidelineScopeCache.delete(userId);
        }
    }

    debugLog(`Attempting to get guideline scope preference for user: ${userId}`);
    
    try {
        // Try Firestore first if available
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    console.log('User preference document exists in Firestore:', data);
                    
                    if (data && data.guidelineScope) {
                        // Cache the preference
                        userGuidelineScopeCache.set(userId, {
                            guidelineScope: data.guidelineScope,
                            timestamp: Date.now()
                        });
                        return data.guidelineScope;
                    }
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserGuidelineScope, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
        
        try {
            if (fs.existsSync(userPrefsFilePath)) {
                const userData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
                debugLog('User preference file exists');
                if (userData && userData.guidelineScope) {
                    // Cache the preference
                    userGuidelineScopeCache.set(userId, {
                        guidelineScope: userData.guidelineScope,
                        timestamp: Date.now()
                    });
                    return userData.guidelineScope;
                }
            }
        } catch (error) {
            console.error('Error reading user preference file:', error);
        }
        
        // No guideline scope set
        return null;
    } catch (error) {
        console.error('Critical error in getUserGuidelineScope:', error);
        return null;
    }
}

// Update user's guideline scope preference
async function updateUserGuidelineScope(userId, scopeSelection) {
    if (scopeSelection === null) {
        console.log(`Clearing guideline scope preference for user ${userId}`);
    } else {
        console.log(`Updating guideline scope preference for user ${userId} to`, scopeSelection);
    }
    
    // Update cache immediately (or clear if null)
    if (scopeSelection === null) {
        userGuidelineScopeCache.delete(userId);
    } else {
        userGuidelineScopeCache.set(userId, {
            guidelineScope: scopeSelection,
            timestamp: Date.now()
        });
    }
    
    try {
        // Try to update in Firestore if available
        if (db) {
            try {
                // Get existing preferences to merge with them
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
                
                // If scopeSelection is null, remove the field; otherwise set it
                if (scopeSelection === null) {
                    // Remove guidelineScope field using update
                    await db.collection('userPreferences').doc(userId).update({
                        guidelineScope: admin.firestore.FieldValue.delete(),
                        updatedAt: new Date().toISOString()
                    });
                } else {
                    // Set the guidelineScope field
                    const updateData = {
                        ...existingData,
                        guidelineScope: scopeSelection,
                        updatedAt: new Date().toISOString()
                    };
                    await db.collection('userPreferences').doc(userId).set(updateData);
                }
                
                console.log(`Successfully ${scopeSelection === null ? 'cleared' : 'updated'} guideline scope preference in Firestore for user: ${userId}`);
                return true;
            } catch (firestoreError) {
                console.error('Firestore error in updateUserGuidelineScope, falling back to file storage:', firestoreError);
                // Fall through to file-based storage
            }
        }
        
        // Fallback to local file storage
        try {
            // Save to local JSON file
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            
            let existingData = {};
            if (fs.existsSync(userPrefsFilePath)) {
                existingData = JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8'));
            }
            
            // If scopeSelection is null, remove the field
            if (scopeSelection === null) {
                delete existingData.guidelineScope;
            } else {
                existingData.guidelineScope = scopeSelection;
            }
            
            existingData.updatedAt = new Date().toISOString();
            
            fs.writeFileSync(userPrefsFilePath, JSON.stringify(existingData));
            
            console.log(`Successfully ${scopeSelection === null ? 'cleared' : 'updated'} guideline scope preference in local file for user: ${userId}`);
            return true;
        } catch (fileError) {
            console.error('Failed to update user preference file:', fileError);
            return false;
        }
    } catch (error) {
        console.error('Error in updateUserGuidelineScope:', error);
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
        case 'Groq':
            // Groq uses OpenAI-compatible format
            return messages.map(msg => ({
                role: msg.role,
                content: msg.content
            }));
        default:
            throw new Error(`Unsupported AI provider: ${provider}`);
    }
}
// Function to send prompts to AI services
// timeoutMs controls the per-request timeout to the upstream AI provider
// skipUserPreference: when true, use the explicitly passed model without overriding with user preferences
//                     (used for chunk distribution where specific providers are assigned)
async function sendToAI(prompt, model = 'deepseek-chat', systemPrompt = null, userId = null, temperature = 0.7, timeoutMs = 120000, skipUserPreference = false) {
  // Initialize preferredProvider at the very beginning to ensure it's always defined
  let preferredProvider = 'DeepSeek'; // Default fallback
  const sendToAIStartTime = Date.now(); // Track start time for Firestore logging
  
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
    } else if (model.includes('gpt') && !model.includes('gpt-oss')) {
      preferredProvider = 'OpenAI';
    } else if (model.includes('groq') || model.includes('llama-3.3') || model.includes('llama-4') || model.includes('gpt-oss') || model.includes('kimi-k2')) {
      preferredProvider = 'Groq';
    } else {
      preferredProvider = 'DeepSeek'; // Default to DeepSeek if unknown model
    }
    
    debugLog('[DEBUG] sendToAI initial configuration:', {
      promptType: typeof prompt,
      isArray: Array.isArray(prompt),
      requestedModel: model,
      initialProvider: preferredProvider,
      hasSystemPrompt: !!systemPrompt,
      userId: userId || 'none',
      skipUserPreference
    });
    
    // Override with userId preference if provided, UNLESS skipUserPreference is true
    // skipUserPreference is used for chunk distribution where we explicitly want to use different providers
    if (userId && !skipUserPreference) {
      try {
        // Use the ordered model preferences (which will fetch if needed)
        // Note: userModelOrder now contains model IDs like 'deepseek-chat', 'llama-3.3-70b-versatile'
        const userModelOrder = await getUserModelPreferences(userId);
        
        if (userModelOrder && userModelOrder.length > 0) {
          // Use the first model in the user's preference order (this is now a model ID)
          const firstPreferredModelId = userModelOrder[0];
          
          // Look up the provider config by model ID
          const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === firstPreferredModelId);
          
          if (providerConfig && providerConfig.name !== preferredProvider) {
            debugLog('[DEBUG] Overriding provider based on user model preferences:', {
              requestedModel: model,
              initialProvider: preferredProvider,
              firstPreferredModelId,
              newProvider: providerConfig.name,
              fullOrder: userModelOrder,
              userId
            });
            preferredProvider = providerConfig.name;
            model = providerConfig.model;
            debugLog('[DEBUG] Updated model to match preferred provider:', model);
          }
        }
      } catch (error) {
        console.error('[DEBUG] Error getting user model preferences:', {
          error: error.message,
          userId,
          usingModelBasedProvider: true
        });
      }
    } else if (skipUserPreference) {
      debugLog('[DEBUG] Skipping user preference override - using explicit provider:', preferredProvider);
    }
    
    // Check if we have the API key for the preferred provider
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    const hasDeepSeekKey = !!process.env.DEEPSEEK_API_KEY;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasMistralKey = !!process.env.MISTRAL_API_KEY;
    const hasGeminiKey = !!process.env.GOOGLE_AI_API_KEY;
    const hasGroqKey = !!process.env.GROQ_API_KEY;
    
    debugLog('[DEBUG] API key availability:', {
      preferredProvider,
      requestedModel: model,
      hasOpenAIKey,
      hasDeepSeekKey,
      hasAnthropicKey,
      hasMistralKey,
      hasGeminiKey,
      hasGroqKey
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
      hasGeminiKey,
      hasGroqKey
    };
    
    // Check if current preferred provider has API key
    const hasCurrentProviderKey = availableKeys[`has${preferredProvider}Key`];
    
    if (!hasCurrentProviderKey) {
      console.log(`[DEBUG] No API key for ${preferredProvider}, searching for next available provider...`);
      
      // Try to use user's preference order for fallback, otherwise use cost order
      // Note: userModelOrder now contains model IDs like 'deepseek-chat', 'llama-3.3-70b-versatile'
      let fallbackModelOrder = AI_PROVIDER_PREFERENCE.map(p => p.model);
      if (userId) {
        try {
          const userModelOrder = await getUserModelPreferences(userId);
          if (userModelOrder && userModelOrder.length > 0) {
            fallbackModelOrder = userModelOrder;
            debugLog('[DEBUG] Using user preference order for fallback:', fallbackModelOrder);
          }
        } catch (error) {
          console.warn('[DEBUG] Error getting user model preferences for fallback, using cost order:', error);
        }
      }
      
      // Find next available provider in the fallback order (by model ID)
      let nextProvider = null;
      const currentIndex = fallbackModelOrder.indexOf(model);
      
      // Start from the next provider after current
      for (let i = currentIndex + 1; i < fallbackModelOrder.length; i++) {
        const modelId = fallbackModelOrder[i];
        const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === modelId);
        if (providerConfig && availableKeys[`has${providerConfig.name}Key`]) {
          nextProvider = providerConfig;
          break;
        }
      }
      
      // If no next provider available, try from the beginning
      if (!nextProvider) {
        for (let i = 0; i < currentIndex; i++) {
          const modelId = fallbackModelOrder[i];
          const providerConfig = AI_PROVIDER_PREFERENCE.find(p => p.model === modelId);
          if (providerConfig && availableKeys[`has${providerConfig.name}Key`]) {
            nextProvider = providerConfig;
            break;
          }
        }
      }
      
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
        temperature: temperature,
        max_tokens: 4000
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        timeout: timeoutMs
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
        temperature: temperature,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
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
        temperature: temperature
      }, {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        timeout: timeoutMs
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
        temperature: temperature,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
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
      // Gemini messages are already formatted by formatMessagesForProvider with parts: [{text}]
      // Just need to adjust roles: Gemini uses 'user' and 'model' (not 'assistant')
      const geminiMessages = formattedMessages.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: msg.parts || [{ text: msg.content || '' }]
      }));
      
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: temperature,
            maxOutputTokens: 4000
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          params: {
            key: process.env.GOOGLE_AI_API_KEY
          },
          timeout: timeoutMs
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
    } else if (preferredProvider === 'Groq') {
      // Groq uses OpenAI-compatible API format
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: model,
        messages: formattedMessages,
        temperature: temperature,
        max_tokens: 4000
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
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
        
        // Calculate approximate cost - Groq pricing (Llama 3.3 70B)
        const inputCost = (tokenUsage.prompt_tokens / 1000) * 0.00059;
        const outputCost = (tokenUsage.completion_tokens / 1000) * 0.00079;
        const totalCost = inputCost + outputCost;
        
        console.log(`Groq API Call Cost Estimate: $${totalCost.toFixed(6)} (Input: $${inputCost.toFixed(6)}, Output: $${outputCost.toFixed(6)})`);
        console.log(`Token Usage: ${tokenUsage.prompt_tokens} prompt tokens, ${tokenUsage.completion_tokens} completion tokens, ${tokenUsage.total_tokens} total tokens`);
        
        tokenUsage.estimated_cost_usd = totalCost;
      }
    }

    // Log to Firestore for analytics (fire-and-forget, non-blocking)
    const latencyMs = Date.now() - sendToAIStartTime;
    if (db) {
      // Prepare prompt string for storage (truncate if very large to stay within Firestore limits)
      const promptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      const MAX_CONTENT_LENGTH = 50000; // 50KB limit per field to be safe
      
      db.collection('aiInteractions').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userId: userId || 'anonymous',
        provider: preferredProvider,
        model: model,
        endpoint: 'sendToAI',
        promptTokens: tokenUsage?.prompt_tokens || 0,
        completionTokens: tokenUsage?.completion_tokens || 0,
        totalTokens: tokenUsage?.total_tokens || 0,
        latencyMs: latencyMs,
        estimatedCostUsd: tokenUsage?.estimated_cost_usd || 0,
        success: true,
        errorMessage: null,
        promptLength: promptStr.length,
        responseLength: content?.length || 0,
        // Full content for debugging (truncated if too large)
        fullPrompt: promptStr.length > MAX_CONTENT_LENGTH 
          ? promptStr.substring(0, MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED - original length: ' + promptStr.length + ']'
          : promptStr,
        fullResponse: (content?.length || 0) > MAX_CONTENT_LENGTH
          ? content.substring(0, MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED - original length: ' + content.length + ']'
          : (content || '')
      }).catch(logErr => {
        console.error('[AI_LOG] Failed to log to Firestore:', logErr.message);
      });
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
    // COST-EFFECTIVE QUOTA/TIMEOUT FALLBACK SYSTEM
    // ============================================================================
    // Check if it's a quota exceeded or timeout error and try next available provider
    const quotaExceededError = error.response?.data?.error?.message?.includes('exceeded your current quota') ||
                               error.response?.data?.error?.message?.includes('quota') ||
                               error.response?.data?.error?.message?.includes('rate limit');
    const timeoutError = error.code === 'ECONNABORTED' ||
                         error.message?.toLowerCase?.().includes('timeout') ||
                         error.message?.toLowerCase?.().includes('timed out');
    
    if (quotaExceededError || timeoutError) {
      console.log(`[DEBUG] ${preferredProvider} ${quotaExceededError ? 'quota exceeded' : 'timeout/error'}, attempting cost-effective fallback...`);
      
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
          // Reconstruct messages for fallback based on original prompt
          let fallbackMessages = [];
          if (Array.isArray(prompt)) {
            fallbackMessages = prompt;
          } else {
            if (systemPrompt) {
              fallbackMessages.push({ role: 'system', content: systemPrompt });
            }
            fallbackMessages.push({ role: 'user', content: prompt });
          }
          const formattedMessages = formatMessagesForProvider(fallbackMessages, nextProvider.name);
          
          let response;
          if (nextProvider.name === 'DeepSeek') {
            response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: temperature,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
            });
          } else if (nextProvider.name === 'OpenAI') {
            response = await axios.post('https://api.openai.com/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: temperature,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
            });
          } else if (nextProvider.name === 'Anthropic') {
            response = await axios.post('https://api.anthropic.com/v1/messages', {
              model: nextProvider.model,
              messages: formattedMessages,
              max_tokens: 4000,
              temperature: temperature
            }, {
              headers: {
                'x-api-key': process.env.ANTHROPIC_API_KEY,
                'Content-Type': 'application/json',
                'anthropic-version': '2023-06-01'
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
            });
          } else if (nextProvider.name === 'Mistral') {
            response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: temperature,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
            });
          } else if (nextProvider.name === 'Gemini') {
            // Gemini messages - handle both formatted (parts) and unformatted (content) messages
            const geminiMessages = formattedMessages.map(msg => ({
              role: msg.role === 'user' ? 'user' : 'model',
              parts: msg.parts || [{ text: msg.content || '' }]
            }));
            
            response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${nextProvider.model}:generateContent`, {
              contents: geminiMessages,
              generationConfig: {
                temperature: temperature,
                maxOutputTokens: 4000
              }
            }, {
              headers: {
                'Content-Type': 'application/json'
              },
              params: {
                key: process.env.GOOGLE_AI_API_KEY
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
            });
          } else if (nextProvider.name === 'Groq') {
            // Groq uses OpenAI-compatible format
            response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
              model: nextProvider.model,
              messages: formattedMessages,
              temperature: temperature,
              max_tokens: 4000
            }, {
              headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json'
              },
              timeout: 120000 // 120 second timeout for fallback AI generation
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
            
            // Log fallback success to Firestore
            const fallbackLatencyMs = Date.now() - sendToAIStartTime;
            if (db) {
              // Prepare prompt string for storage (truncate if very large)
              const fallbackPromptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
              const FB_MAX_CONTENT_LENGTH = 50000;
              
              db.collection('aiInteractions').add({
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                userId: userId || 'anonymous',
                provider: nextProvider.name,
                model: nextProvider.model,
                endpoint: 'sendToAI-fallback',
                promptTokens: tokenUsage?.prompt_tokens || 0,
                completionTokens: tokenUsage?.completion_tokens || 0,
                totalTokens: tokenUsage?.total_tokens || 0,
                latencyMs: fallbackLatencyMs,
                estimatedCostUsd: tokenUsage?.estimated_cost_usd || 0,
                success: true,
                errorMessage: null,
                promptLength: fallbackPromptStr.length,
                responseLength: content?.length || 0,
                fallbackFrom: preferredProvider,
                // Full content for debugging (truncated if too large)
                fullPrompt: fallbackPromptStr.length > FB_MAX_CONTENT_LENGTH 
                  ? fallbackPromptStr.substring(0, FB_MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED - original length: ' + fallbackPromptStr.length + ']'
                  : fallbackPromptStr,
                fullResponse: (content?.length || 0) > FB_MAX_CONTENT_LENGTH
                  ? content.substring(0, FB_MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED - original length: ' + content.length + ']'
                  : (content || '')
              }).catch(logErr => {
                console.error('[AI_LOG] Failed to log fallback to Firestore:', logErr.message);
              });
            }
            
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
    
    // Log failure to Firestore
    const failureLatencyMs = Date.now() - sendToAIStartTime;
    if (db) {
      // Prepare prompt string for storage (truncate if very large)
      const failPromptStr = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
      const FAIL_MAX_CONTENT_LENGTH = 50000;
      
      db.collection('aiInteractions').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        userId: userId || 'anonymous',
        provider: preferredProvider,
        model: model,
        endpoint: 'sendToAI',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: failureLatencyMs,
        estimatedCostUsd: 0,
        success: false,
        errorMessage: (error.response?.data?.error?.message || error.message || 'Unknown error').substring(0, 500),
        promptLength: failPromptStr.length,
        responseLength: 0,
        // Full prompt for debugging failed requests (truncated if too large)
        fullPrompt: failPromptStr.length > FAIL_MAX_CONTENT_LENGTH 
          ? failPromptStr.substring(0, FAIL_MAX_CONTENT_LENGTH) + '\n\n[TRUNCATED - original length: ' + failPromptStr.length + ']'
          : failPromptStr,
        fullResponse: null
      }).catch(logErr => {
        console.error('[AI_LOG] Failed to log error to Firestore:', logErr.message);
      });
    }
    
    throw new Error(`AI request failed: ${error.response?.data?.error?.message || error.message}`);
  }
}

// Update the route function to use the new sendToAI
async function routeToAI(prompt, userId = null, preferredProvider = null) {
  try {
    // Set default AI provider to the cheapest available option
    const defaultProvider = AI_PROVIDER_PREFERENCE[0].name; // DeepSeek (cheapest)
    
    debugLog('[DEBUG] routeToAI called with:', {
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
          debugLog('[DEBUG] User AI preference retrieved:', {
            userId,
            provider,
            defaultProvider
          });
        } else {
          debugLog('[DEBUG] No user preference found, using cheapest provider:', {
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
      debugLog('[DEBUG] Using EXPLICIT provider for chunk distribution (will skip user preference):', {
        preferredProvider,
        provider
      });
    } else {
      debugLog('[DEBUG] No user ID provided, using cheapest provider:', {
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
        model = 'claude-3-haiku-20240307';
        break;
      case 'Mistral':
        model = 'mistral-large-latest';
        break;
      case 'Gemini':
        model = 'gemini-2.5-flash';
        break;
      case 'Groq':
        model = 'llama-3.3-70b-versatile';
        break;
      default:
        model = 'deepseek-chat';
    }
    // If preferredProvider was explicitly passed, tell sendToAI to skip user preference override
    // This is critical for chunk distribution to work - each chunk should use its assigned provider
    const skipUserPreference = !!preferredProvider;
    
    debugLog('[DEBUG] Selected AI configuration:', {
      provider,
      model,
      skipUserPreference,
      hasOpenAIKey: !!process.env.OPENAI_API_KEY,
      hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
      hasAnthropicKey: !!process.env.ANTHROPIC_API_KEY,
      hasMistralKey: !!process.env.MISTRAL_API_KEY,
      hasGeminiKey: !!process.env.GOOGLE_AI_API_KEY,
      hasGroqKey: !!process.env.GROQ_API_KEY
    });
    
    // Handle both string prompts and message objects
    
    let result;
    if (typeof prompt === 'object' && prompt.messages) {
      // If prompt is a message object, use it directly with optional temperature
      const temperature = prompt.temperature !== undefined ? prompt.temperature : 0.7;
      result = await sendToAI(prompt.messages, model, null, userId, temperature, 120000, skipUserPreference);
    } else {
      // If prompt is a string, use it as a user message
      result = await sendToAI(prompt, model, null, userId, 0.7, 120000, skipUserPreference);
    }
    
    debugLog('[DEBUG] AI service response:', JSON.stringify({
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
    debugLog('[DEBUG] generateFakeClinicalInteraction: AI response structure:', {
      hasResponse: !!response,
      responseKeys: response ? Object.keys(response) : 'no response',
      hasContent: !!response?.content,
      contentLength: response?.content?.length || 0,
      contentPreview: response?.content ? response.content.substring(0, 100) + '...' : 'NO CONTENT'
    });
    
    // Prepare the response to send to client
    const clientResponse = { success: true, response };
    
    debugLog('[DEBUG] generateFakeClinicalInteraction: Client response structure:', {
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
            // Normalise American spelling to British (gynecology -> gynaecology)
            let category = data.category || 'uncategorized';
            if (category === 'gynecology') {
                category = 'gynaecology';
            }
            
            if (!conditions[category]) {
                conditions[category] = {};
            }
            
            conditions[category][data.name] = {
                id: doc.id,
                name: data.name,
                category: category, // Use normalised category
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
    debugLog('[DEBUG] checkGitHubPermissions: Starting GitHub permissions check...');
    
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
                },
                timeout: 5000
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
                },
                timeout: 5000
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
                },
                timeout: 5000
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
                },
                timeout: 5000
            });
            results.actions = true;
        } catch (error) {
            results.details.actions = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        debugLog('[DEBUG] checkGitHubPermissions: Permissions check complete, results:', {
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
    debugLog('[DEBUG] testGitHubAccess: Starting GitHub access test...');
    
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}`;
        
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${githubToken}`
            },
            timeout: 8000 // 8 second timeout
        });
        
        return true;
    } catch (error) {
        console.error('[ERROR] testGitHubAccess: GitHub access test failed:', error.response?.data?.message || error.code);
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
    
    // Debug the input content (only when DEBUG_LOGGING is enabled)
    debugLog(`saveToGitHub called with type: ${type}`, {
        contentKeys: Object.keys(content),
        hasTextContent: 'textContent' in content,
        hasAiProvider: 'ai_provider' in content,
        githubTokenLength: githubToken ? githubToken.length : 0
    });
    
    // OPTIMISATION: Create minimal log content instead of full text (MOVED BEFORE USE TO FIX TDZ ERROR)
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
    
    debugLog('Creating optimised log summary:', {
        type: summary.type,
        promptLength: summary.prompt_length,
        responseLength: summary.response_length,
        tokenUsage: summary.token_usage
    });

    // First, try saving to GitHub
    while (attempt < MAX_RETRIES && !success) {
        try {
            debugLog(`saveToGitHub attempt ${attempt + 1}/${MAX_RETRIES} for ${type}...`);
            
            // Add delay between retries (except for first attempt)
            if (attempt > 0) {
                const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
                debugLog(`Waiting ${delayMs}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            if (!githubToken) {
                console.error('GitHub token is missing, falling back to local save');
                break;
            }
            
            // OPTIMISATION: Skip .txt files, only save JSON to reduce GitHub storage by 50%
            // (no log needed - this is standard behaviour now)

            const jsonUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${jsonPath}`;
            debugLog(`Attempting to save JSON file to GitHub: ${jsonPath}`);
            const response = await axios.put(jsonUrl, jsonBody, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                },
                timeout: 30000, // 30 second timeout
                maxRetries: 0 // Disable axios retries, we handle our own
            });

            success = true;
            debugLog(`GitHub save completed: ${type} after ${attempt + 1} attempt(s)`);
        } catch (error) {
            if (error.response?.status === 409) {
                debugLog('Conflict detected, fetching latest SHA and retrying...');
                try {
                    const fileSha = await getFileSha(jsonPath);
                    if (fileSha) {
                        jsonBody.sha = fileSha;
                        // Don't increment attempt counter for conflict resolution retry
                        // The attempt++ at the end of the loop will still happen, so we decrement here
                        attempt--;
                    } else {
                        console.error('Could not retrieve SHA for conflict resolution');
                    }
                } catch (shaError) {
                    console.error('Error getting file SHA for conflict resolution:', shaError.message);
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
                        // Create logs directory if it doesn't exist
                        const localLogsDir = './logs/local-ai-interactions';
                        if (!fs.existsSync(localLogsDir)) {
                            fs.mkdirSync(localLogsDir, { recursive: true });
                        }
                        
                        // OPTIMISATION: Write only optimised JSON file locally
                        const localJsonPath = `${localLogsDir}/${timestamp}-${type}.json`;
                        fs.writeFileSync(localJsonPath, JSON.stringify(minimalContent, null, 2));
                        debugLog(`Saved log locally: ${localJsonPath}`);
                        
                        success = true; // Consider this a success since we saved it locally
                        break;
                    } catch (localError) {
                        console.error('Failed to save logs locally:', localError.message);
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
      // Skipping non-critical endpoint logging to reduce noise
      return true;
    }
    
    // Log the raw inputs for debugging (only when DEBUG_LOGGING is enabled)
    debugLog('logAIInteraction called with:', JSON.stringify({
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
    
    // Print a deep inspection of the response object for debugging (only when DEBUG_LOGGING is enabled)
    debugLog('Full response structure:', JSON.stringify(response, null, 2));
    
    // Extract AI information if it exists in the response
    if (response && typeof response === 'object') {
      debugLog('Response object structure:', JSON.stringify({
        hasContent: 'content' in response,
        hasResponse: 'response' in response,
        hasAIProvider: 'ai_provider' in response,
        hasTokenUsage: 'token_usage' in response,
        hasNestedAIProvider: response.response && typeof response.response === 'object' && 'ai_provider' in response.response
      }, null, 2));
      
      // Extract token usage if available
      if (response.token_usage) {
        token_usage = response.token_usage;
      } else if (response.response && response.response.token_usage) {
        token_usage = response.response.token_usage;
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
    debugLog('Logging AI interaction:', JSON.stringify({ endpoint, ai_info }, null, 2));
    
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
    
    // Debug the content we're about to save (only when DEBUG_LOGGING is enabled)
    debugLog(`Prepared log content for ${endpoint}:`, {
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
      
      debugLog(`Successfully logged AI interaction for endpoint: ${endpoint}`);
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
    // Lightweight guideline formatting - only title + summary for relevance determination
    // This reduces token usage significantly, allowing larger chunks and faster processing
    const guidelinesText = guidelinesChunk.map(g => {
        let guidelineInfo = `[${g.id}] ${g.title}`;
        
        // Add summary if available - this is sufficient for relevance scoring
        if (g.summary && g.summary.trim()) {
            guidelineInfo += `\nSummary: ${g.summary.trim()}`;
        }
        
        // Add keywords for additional context (lightweight)
        if (g.keywords && Array.isArray(g.keywords) && g.keywords.length > 0) {
            guidelineInfo += `\nKeywords: ${g.keywords.slice(0, 10).join(', ')}`; // Limit to 10 keywords
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
    debugLog('[DEBUG] Re-categorized guidelines based on scores:', {
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
            debugLog('[DEBUG] Extracted JSON from markdown code block');
        }
        
        // Try to parse as JSON first
        const parsed = JSON.parse(cleanContent);
        debugLog('[DEBUG] JSON parsing successful');
        
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
                        debugLog(`[DEBUG] Found guideline by fuzzy title match: "${item.title}" -> ${guideline.id} (Rating: ${bestMatch.rating.toFixed(2)})`);
                        
                        // Return the matched guideline with preserved fields and relevance
                        return {
                            ...guideline, // Preserve all original fields including downloadUrl
                            relevance: item.relevance || '0.5' // Use item's relevance or default
                        };
                    }
                }
                
                // If no match found, return the item with a warning
                debugLog(`[DEBUG] Could not match AI guideline to original: "${item.title}"`);
                return {
                    id: item.id || 'unknown-id',
                    title: item.title,
                    relevance: item.relevance || '0.0'
                };
            });
        });
        
        debugLog('[DEBUG] JSON parsing completed successfully');
        
        return { success: true, categories: cleanedCategories };
    } catch (jsonError) {
        debugLog('[DEBUG] JSON parsing failed:', {
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
        
        debugLog('[DEBUG] Attempting text parsing on', lines.length, 'lines with', originalChunk.length, 'original guidelines');
        
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            
            // Check for category headers
            if (trimmed.toLowerCase().includes('most relevant') || trimmed.includes('mostRelevant')) {
                currentCategory = 'mostRelevant';
            } else if (trimmed.toLowerCase().includes('potentially relevant') || trimmed.includes('potentiallyRelevant')) {
                currentCategory = 'potentiallyRelevant';
            } else if (trimmed.toLowerCase().includes('less relevant') || trimmed.includes('lessRelevant')) {
                currentCategory = 'lessRelevant';
            } else if (trimmed.toLowerCase().includes('not relevant') || trimmed.includes('notRelevant')) {
                currentCategory = 'notRelevant';
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
                    debugLog(`[DEBUG] Found guideline by fuzzy title match: "${potentialTitle}" -> ${guideline.id} (Rating: ${bestMatch.rating.toFixed(2)})`);
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
        
        debugLog('[DEBUG] Text parsing completed:', {
            totalParsed: parsedCount,
            totalOriginal: originalChunk.length,
            categoryCounts: Object.keys(categories).map(cat => `${cat}: ${categories[cat].length}`).join(', ')
        });
        
        return { success: true, categories };
    }
}
// Main findRelevantGuidelines endpoint with concurrent chunking
app.post('/findRelevantGuidelines', authenticateUser, async (req, res) => {
  // Initialize step timer for profiling
  const timer = new StepTimer('/findRelevantGuidelines');
  req.stepTimer = timer;
  
  try {
    const { transcript, guidelinesPayload, anonymisationInfo, scope, hospitalTrust } = req.body;
    const userId = req.user.uid;
    timer.step('Parse request');
    
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
          console.log('[CACHE] Partial payload received, loading full guidelines from cache...');
                     const fullGuidelines = await getCachedGuidelines();
          guidelines = fullGuidelines;
        }
      } else {
        // No cache, all guidelines should be in newGuidelines
        guidelines = guidelinesPayload.newGuidelines || [];
      }
    } else {
      // Fallback: load guidelines from cache if no payload
      console.log('[CACHE] No guidelines payload, loading from cache...');
             guidelines = await getCachedGuidelines();
    }
    timer.step('Load guidelines');
    
    // Apply scope filtering if specified
    if (scope) {
      console.log('[SCOPE_FILTER] Filtering guidelines by scope:', { scope, hospitalTrust, beforeFilter: guidelines.length });
      
      if (scope === 'national') {
        // Only national guidelines
        guidelines = guidelines.filter(g => {
          const guidelineScope = g.scope || 'national';
          return guidelineScope === 'national';
        });
      } else if (scope === 'local') {
        // Only local guidelines for the specified trust
        if (hospitalTrust) {
          guidelines = guidelines.filter(g => {
            const guidelineScope = g.scope || 'national';
            return guidelineScope === 'local' && g.hospitalTrust === hospitalTrust;
          });
        } else {
          console.log('[SCOPE_FILTER] No hospital trust specified for local scope, returning no guidelines');
          guidelines = [];
        }
      } else if (scope === 'both') {
        // National guidelines + local guidelines for specified trust
        guidelines = guidelines.filter(g => {
          const guidelineScope = g.scope || 'national';
          if (guidelineScope === 'national') {
            return true;
          }
          if (guidelineScope === 'local' && hospitalTrust && g.hospitalTrust === hospitalTrust) {
            return true;
          }
          return false;
        });
      }
      
      console.log('[SCOPE_FILTER] After filtering:', guidelines.length, 'guidelines');
    }
    timer.step('Apply filters');
    
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
    const CHUNK_SIZE = 40; // Using lightweight summaries allows larger chunks
    const chunks = [];
    
    // Split guidelines into chunks
    for (let i = 0; i < guidelines.length; i += CHUNK_SIZE) {
        chunks.push(guidelines.slice(i, i + CHUNK_SIZE));
    }
    
    console.log(`[DEBUG] Created ${chunks.length} chunks of max ${CHUNK_SIZE} guidelines each`);
    timer.step('Create chunks');
    
    // Get available AI providers for parallel distribution (env keys + user preference)
    const enabledChunkProviders = await getUserChunkDistributionProviders(userId).catch(() => AI_PROVIDER_PREFERENCE.map(p => p.name));
    const envAvailableProviders = [];
    if (process.env.DEEPSEEK_API_KEY) envAvailableProviders.push('DeepSeek');
    if (process.env.MISTRAL_API_KEY) envAvailableProviders.push('Mistral');
    if (process.env.ANTHROPIC_API_KEY) envAvailableProviders.push('Anthropic');
    if (process.env.OPENAI_API_KEY) envAvailableProviders.push('OpenAI');
    if (process.env.GOOGLE_AI_API_KEY) envAvailableProviders.push('Gemini'); // Note: env var is GOOGLE_AI_API_KEY, provider name is Gemini
    if (process.env.GROQ_API_KEY) envAvailableProviders.push('Groq');
    
    let availableProviders = envAvailableProviders.filter(p => enabledChunkProviders.includes(p));
    if (availableProviders.length === 0) {
        // Safety: if user disables everything, fall back to env-available providers
        console.warn('[WARN] No enabled providers for chunk distribution; falling back to env-available providers');
        availableProviders = envAvailableProviders;
    }
    
    console.log(`[CHUNK DISTRIBUTION] User ${userId} enabled providers: ${enabledChunkProviders.join(', ')}`);
    console.log(`[CHUNK DISTRIBUTION] Env-available providers: ${envAvailableProviders.join(', ')}`);
    console.log(`[CHUNK DISTRIBUTION] Using ${availableProviders.length} providers for ${chunks.length} chunks: ${availableProviders.join(', ')}`);
    
    // Process all chunks concurrently, distributing across providers
    // Track timing for each model to identify slow providers
    const chunkTimings = [];
    
    const chunkPromises = chunks.map(async (chunk, index) => {
        // Round-robin distribution across available providers
        const providerIndex = index % availableProviders.length;
        const provider = availableProviders[providerIndex] || null;
        const chunkStartTime = Date.now();
        
        try {
            console.log(`[DEBUG] Processing chunk ${index + 1}/${chunks.length} with ${chunk.length} guidelines via ${provider || 'default'}`);
            
            const prompt = createPromptForChunk(transcript, chunk);
            const aiResponse = await routeToAI(prompt, userId, provider);
            
            const chunkDuration = Date.now() - chunkStartTime;
            chunkTimings.push({ 
                chunk: index + 1, 
                provider: provider || 'default', 
                duration: chunkDuration,
                status: 'OK',
                guidelinesCount: chunk.length
            });
            
            // Extract content from the response
            const responseContent = aiResponse && typeof aiResponse === 'object' 
                ? aiResponse.content 
                : aiResponse;
                
            if (!responseContent) {
                throw new Error(`Invalid response format from AI service for chunk ${index + 1}`);
            }
            
            // Log each chunk's AI response for debugging
            console.log(`[DEBUG] Chunk ${index + 1} (${provider || 'default'}) completed in ${chunkDuration}ms`);
            
            // Log the interaction for this chunk (fire-and-forget so it doesn't slow the endpoint)
            try {
                logAIInteraction({
                    prompt: `Chunk ${index + 1}/${chunks.length}`,
                    transcriptLength: transcript.length,
                    transcriptPreview: transcript.substring(0, 500) + '...',
                    chunkGuidelines: chunk.map(g => `${g.id}: ${g.title}`),
                    chunkIndex: index + 1,
                    totalChunks: chunks.length,
                    duration: chunkDuration
                }, {
                    success: true,
                    aiResponse: responseContent,
                    responseType: typeof responseContent,
                    responseLength: responseContent.length
                }, `findRelevantGuidelines-chunk-${index + 1}`).catch((logError) => {
                    console.error(`Error logging chunk ${index + 1} interaction:`, logError);
                });
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
            const chunkDuration = Date.now() - chunkStartTime;
            chunkTimings.push({ 
                chunk: index + 1, 
                provider: provider || 'default', 
                duration: chunkDuration,
                status: 'FAIL',
                error: error.message,
                guidelinesCount: chunk.length
            });
            console.error(`[ERROR] Error processing chunk ${index + 1} after ${chunkDuration}ms:`, error);
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
    
    // Aggregate model timing stats
    const modelStats = {};
    chunkTimings.forEach(ct => {
        if (!modelStats[ct.provider]) {
            modelStats[ct.provider] = { 
                count: 0, 
                totalDuration: 0, 
                minDuration: Infinity, 
                maxDuration: 0,
                failures: 0 
            };
        }
        const stats = modelStats[ct.provider];
        stats.count++;
        stats.totalDuration += ct.duration;
        stats.minDuration = Math.min(stats.minDuration, ct.duration);
        stats.maxDuration = Math.max(stats.maxDuration, ct.duration);
        if (ct.status === 'FAIL') stats.failures++;
    });
    
    // Convert to array and calculate averages
    const modelTimingSummary = Object.entries(modelStats).map(([provider, stats]) => ({
        provider,
        count: stats.count,
        avgDuration: Math.round(stats.totalDuration / stats.count),
        minDuration: stats.minDuration === Infinity ? 0 : stats.minDuration,
        maxDuration: stats.maxDuration,
        failures: stats.failures
    })).sort((a, b) => b.avgDuration - a.avgDuration); // Slowest first
    
    // Add model timing as steps for the endpoint performance monitor
    chunkTimings.sort((a, b) => b.duration - a.duration).forEach(ct => {
        timer.step(`${ct.provider} chunk ${ct.chunk} (${ct.status})`);
        // Override the duration for this step with actual chunk duration
        const lastStep = timer.steps[timer.steps.length - 1];
        if (lastStep) lastStep.duration = ct.duration;
    });
    
    console.log(`[DEBUG] Processed ${successfulResults.length}/${chunks.length} chunks successfully`);
    console.log(`[CHUNK TIMING] Model performance:`, modelTimingSummary);
    timer.step(`Process ${chunks.length} AI chunks`);
    
    if (successfulResults.length === 0) {
        throw new Error('All chunks failed to process');
    }
    
    // Merge all categorized results
    const mergedCategories = mergeChunkResults(successfulResults);
    timer.step('Merge results');
    
    // Log the interaction (fire-and-forget)
    try {
        logAIInteraction({
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
        }, 'findRelevantGuidelines').catch((logError) => {
            console.error('Error logging interaction:', logError);
        });
    } catch (logError) {
        console.error('Error logging interaction:', logError);
    }

    res.json({ 
        success: true, 
        categories: mergedCategories,
        chunksProcessed: successfulResults.length,
        totalChunks: chunks.length,
        modelTiming: modelTimingSummary,
        chunkTimings: chunkTimings.sort((a, b) => b.duration - a.duration) // Slowest first
    });
    
  } catch (error) {
    console.error('[ERROR] Error in findRelevantGuidelines:', error);
    
    // Log the error (fire-and-forget)
    try {
        logAIInteraction({
            transcript: req.body.transcript,
            guidelinesCount: req.body.guidelines?.length || 0
        }, {
            success: false,
            error: error.message
        }, 'findRelevantGuidelines').catch((logError) => {
            console.error('Error logging failure:', logError);
        });
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
            debugLog(`[DUPLICATE_CHECK] Retrieved ${githubGuidelines.length} guidelines from GitHub for validation`);
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
                                // File doesn't exist in GitHub, check if within grace period
                                const uploadedAt = data.uploadedAt?.toDate?.() || data.uploadedAt;
                                const now = new Date();
                                const ageMs = uploadedAt ? now - new Date(uploadedAt) : Infinity;
                                const GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes
                                
                                if (ageMs > GRACE_PERIOD_MS) {
                                    // Only delete if outside grace period
                                    staleRecordsToCleanup.push({
                                        id: doc.id,
                                        filename: filename,
                                        hash: hash
                                    });
                                    debugLog(`[DUPLICATE_CHECK] Stale record found for hash: ${hash.substring(0, 16)}...`);
                                } else {
                                    debugLog(`[DUPLICATE_CHECK] Skipping recent upload (within grace period): ${filename}`);
                                }
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
// DEPRECATED: Old GitHub-based upload endpoint - kept for backwards compatibility
app.post('/uploadGuideline', authenticateUser, upload.single('file'), async (req, res) => {
    console.warn('[UPLOAD] ⚠️  DEPRECATED: /uploadGuideline endpoint called. Please use /uploadGuidelinePDF instead.');
    console.warn('[UPLOAD] This endpoint uploads to GitHub which may fail. New endpoint uses Firebase Storage.');
    
    // Check if a file was uploaded
    if (!req.file) {
        console.error('No file uploaded');
        return res.status(400).json({ 
            message: 'No file uploaded',
            warning: 'This endpoint is deprecated. Please use /uploadGuidelinePDF for better reliability.'
        });
    }

    try {
        const userId = req.user.uid;
        const file = req.file;
        const fileName = file.originalname;
        
        // Check if the target folder exists in the GitHub repository
        const folderExists = await checkFolderExists(githubFolder);
        if (!folderExists) {
            return res.status(400).json({ message: 'Target folder does not exist in the repository' });
        }

        // Extract file content (file and fileName already declared above)
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
                    
                    // Debug: Log entire request to see what's being received
                    console.log(`[UPLOAD] req.body:`, JSON.stringify(req.body));
                    console.log(`[UPLOAD] req.file:`, req.file ? `exists (${req.file.originalname})` : 'missing');
                    console.log(`[UPLOAD] req.body keys:`, Object.keys(req.body));
                    console.log(`[UPLOAD] req.body.scope:`, req.body.scope);
                    console.log(`[UPLOAD] req.body.nation:`, req.body.nation);
                    console.log(`[UPLOAD] req.body.hospitalTrust:`, req.body.hospitalTrust);
                    
                    // Get scope information from request body
                    const scope = req.body.scope || 'national';
                    const nation = req.body.nation || null;
                    const hospitalTrust = req.body.hospitalTrust || null;
                    
                    const title = fileName.replace(/\.[^/.]+$/, ''); // Remove extension for title
                    const basicGuidelineDoc = {
                        id: cleanId,
                        title: title,
                        displayName: generateDisplayName(title), // Generate rule-based display name initially, AI will improve it in background
                        filename: fileName,
                        originalFilename: fileName,
                        fileHash: fileHash,
                        downloadUrl: `https://github.com/iannouvel/clerky/raw/main/guidance/${encodeURIComponent(fileName)}`,
                        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                        uploadedBy: userId,
                        processed: false, // Mark as not fully processed yet
                        content: null, // Will be filled by sync process
                        summary: null,
                        keywords: [],
                        condensed: null,
                        auditableElements: [], // Will be filled by sync process
                        scope: scope,
                        nation: scope === 'national' ? nation : null,
                        hospitalTrust: scope === 'local' ? hospitalTrust : null
                    };
                    
                    console.log(`[UPLOAD] Storing guideline with scope: ${scope}, nation: ${nation}, hospitalTrust: ${hospitalTrust}`);
                    
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

// New endpoint: Upload PDF directly to Firebase Storage and process
app.post('/uploadGuidelinePDF', authenticateUser, upload.single('file'), async (req, res) => {
    console.log('[UPLOAD_PDF] Starting PDF upload to Firebase Storage');
    
    // Check if a file was uploaded
    if (!req.file) {
        console.error('[UPLOAD_PDF] No file uploaded');
        return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    try {
        const userId = req.user.uid;
        const file = req.file;
        const fileName = file.originalname;
        const fileBuffer = file.buffer;
        
        console.log(`[UPLOAD_PDF] Processing file: ${fileName}, size: ${fileBuffer.length} bytes`);
        
        // Validate it's a PDF
        if (!fileName.toLowerCase().endsWith('.pdf')) {
            return res.status(400).json({ success: false, error: 'Only PDF files are allowed' });
        }
        
        // Calculate file hash for duplicate detection
        const fileHash = await calculateFileHash(fileBuffer);
        console.log(`[UPLOAD_PDF] Calculated hash: ${fileHash.substring(0, 16)}...`);
        
        // Check for duplicate by hash
        const existingDocs = await db.collection('guidelines')
            .where('fileHash', '==', fileHash)
            .limit(1)
            .get();
        
        if (!existingDocs.empty) {
            const existingDoc = existingDocs.docs[0];
            console.log(`[UPLOAD_PDF] Duplicate detected: ${existingDoc.id}`);
            return res.status(409).json({ 
                success: false, 
                error: 'This PDF already exists in the database',
                existingGuidelineId: existingDoc.id
            });
        }
        
        // Generate clean guideline ID
        const guidelineId = fileName
            .replace('.pdf', '')
            .toLowerCase()
            .replace(/[^a-z0-9\-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        console.log(`[UPLOAD_PDF] Generated guideline ID: ${guidelineId}`);
        
        // Upload PDF to Firebase Storage
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const storageFile = bucket.file(`pdfs/${fileName}`);
        
        await storageFile.save(fileBuffer, {
            metadata: {
                contentType: 'application/pdf',
                metadata: {
                    uploadedBy: userId,
                    uploadedAt: new Date().toISOString(),
                    originalName: fileName
                }
            }
        });
        
        console.log(`[UPLOAD_PDF] PDF uploaded to Firebase Storage: pdfs/${fileName}`);
        
        // Get metadata from request body
        const title = req.body.title || fileName.replace('.pdf', '');
        const organisation = req.body.organisation || 'Unknown';
        const yearProduced = req.body.yearProduced || 'Unknown';
        const scope = req.body.scope || 'national';
        const nation = req.body.nation || null;
        const hospitalTrust = req.body.hospitalTrust || null;
        
        // Create guideline document in Firestore with processing status
        const guidelineDoc = {
            id: guidelineId,
            title: title,
            displayName: generateDisplayName(title || fileName), // Generate rule-based display name initially, AI will improve it in background
            filename: fileName,
            originalFilename: fileName,
            fileHash: fileHash,
            organisation: organisation,
            yearProduced: yearProduced,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
            uploadedBy: userId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
            processing: true,
            processingStatus: {
                contentExtracted: false,
                condensedGenerated: false,
                summaryGenerated: false,
                termsExtracted: false,
                auditableExtracted: false
            },
            processingErrors: {},
            scope: scope,
            nation: scope === 'national' ? nation : null,
            hospitalTrust: scope === 'local' ? hospitalTrust : null,
            keywords: [],
            categories: [],
            url: '',
            metadataComplete: false
        };
        
        await db.collection('guidelines').doc(guidelineId).set(guidelineDoc);
        console.log(`[UPLOAD_PDF] Created Firestore document: ${guidelineId}`);
        
        // Queue background processing jobs
        console.log(`[UPLOAD_PDF] Queueing background processing jobs for: ${guidelineId}`);
        queueJob('extract_content', guidelineId);
        queueJob('generate_condensed', guidelineId);
        queueJob('generate_summary', guidelineId);
        queueJob('extract_terms', guidelineId);
        queueJob('extract_auditable', guidelineId);
        
        res.json({
            success: true,
            message: 'PDF uploaded successfully. Processing in background...',
            guidelineId: guidelineId,
            filename: fileName,
            processing: true,
            statusUrl: `/getProcessingStatus?guidelineId=${guidelineId}`
        });
        
    } catch (error) {
        console.error('[UPLOAD_PDF] Error:', error.message);
        console.error('[UPLOAD_PDF] Stack:', error.stack);
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to upload and process PDF'
        });
    }
});

// Endpoint to check processing status
app.get('/getProcessingStatus', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.query;
        
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'guidelineId is required' });
        }
        
        const doc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Guideline not found' });
        }
        
        const data = doc.data();
        
        // Check if all processing is complete
        const allComplete = data.processingStatus &&
            data.processingStatus.contentExtracted &&
            data.processingStatus.condensedGenerated &&
            data.processingStatus.summaryGenerated &&
            data.processingStatus.termsExtracted &&
            data.processingStatus.auditableExtracted;
        
        res.json({
            success: true,
            guidelineId: guidelineId,
            processing: data.processing || false,
            processingStatus: data.processingStatus || {},
            processingErrors: data.processingErrors || {},
            allComplete: allComplete,
            lastUpdated: data.lastUpdated
        });
        
    } catch (error) {
        console.error('[GET_STATUS] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to manually trigger background processing
app.post('/processGuidelineBackground', authenticateUser, async (req, res) => {
    try {
        const { guidelineId, force } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'guidelineId is required' });
        }
        
        // Check if user is admin
        const isAdmin = req.user.admin;
        if (!isAdmin) {
            return res.status(403).json({ success: false, error: 'Admin access required' });
        }
        
        const doc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!doc.exists) {
            return res.status(404).json({ success: false, error: 'Guideline not found' });
        }
        
        const data = doc.data();
        
        console.log(`[PROCESS_BG] Manual processing triggered for: ${guidelineId}`);
        
        // Queue jobs for missing content
        const jobs = [];
        
        if (force || !data.content || !data.processingStatus?.contentExtracted) {
            jobs.push(queueJob('extract_content', guidelineId));
        }
        
        if (force || !data.condensed || !data.processingStatus?.condensedGenerated) {
            jobs.push(queueJob('generate_condensed', guidelineId));
        }
        
        if (force || !data.summary || !data.processingStatus?.summaryGenerated) {
            jobs.push(queueJob('generate_summary', guidelineId));
        }
        
        if (force || !data.significantTerms || !data.processingStatus?.termsExtracted) {
            jobs.push(queueJob('extract_terms', guidelineId));
        }
        
        if (force || !data.auditableElements || !data.processingStatus?.auditableExtracted) {
            jobs.push(queueJob('extract_auditable', guidelineId));
        }
        
        // Update processing flag
        await db.collection('guidelines').doc(guidelineId).update({
            processing: true,
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            message: `Queued ${jobs.length} processing jobs`,
            guidelineId: guidelineId,
            jobsQueued: jobs.length
        });
        
    } catch (error) {
        console.error('[PROCESS_BG] Error:', error);
        res.status(500).json({ success: false, error: error.message });
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

// DEPRECATED: Now fetches from Firestore instead of GitHub
async function getFileContents(fileName) {
    try {
        debugLog(`[FETCH_CONTENT] Fetching content from Firestore for: ${fileName}`);
        
        // Extract the filename from the path and generate guideline ID
        const fileNameOnly = fileName.split('/').pop();
        const guidelineId = fileNameOnly
            .replace('.txt', '')
            .replace('.pdf', '')
            .toLowerCase()
            .replace(/[^a-z0-9\-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        
        // Fetch from Firestore guidelines collection
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (guidelineDoc.exists) {
            const data = guidelineDoc.data();
            
            // Return appropriate field based on the path
            if (fileName.includes('/condensed/')) {
                return data.condensed || data.content;
            } else if (fileName.includes('/summary/')) {
                return data.summary || data.condensed || data.content;
            } else {
                return data.content || data.condensed;
            }
        }
        
        console.warn(`[FETCH_CONTENT] No content found in Firestore for: ${fileName} (ID: ${guidelineId})`);
        return null;
    } catch (error) {
        console.error('[FETCH_CONTENT] Error fetching content from Firestore:', error.message);
        throw new Error('Failed to get file contents');
    }
}

// DEPRECATED: Now fetches from Firestore instead of GitHub
async function getGuidelinesList() {
    try {
        console.log('[GET_GUIDELINES_LIST] Fetching guidelines list from Firestore');
        
        // Fetch all guidelines from Firestore
        const snapshot = await db.collection('guidelines').get();
        
        // Build list in format similar to the old text file (one filename per line)
        const guidelines = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            const filename = data.filename || data.originalFilename;
            if (filename) {
                guidelines.push(filename);
            }
        });
        
        // Return as newline-separated string to match old behavior
        const result = guidelines.sort().join('\n');
        console.log(`[GET_GUIDELINES_LIST] Found ${guidelines.length} guidelines in Firestore`);
        return result;
    } catch (error) {
        console.error('[GET_GUIDELINES_LIST] Error fetching guidelines from Firestore:', error.message);
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

// Get user's model preferences (ordered list)
app.get('/getModelPreferences', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const modelOrder = await getUserModelPreferences(userId);
    return res.json({ success: true, modelOrder });
  } catch (error) {
    console.error('Error getting model preferences:', error);
    // Return default order on error (use model ID as unique key)
    const defaultOrder = AI_PROVIDER_PREFERENCE.map(p => p.model);
    return res.json({ success: true, modelOrder: defaultOrder });
  }
});

// Update user's model preferences (ordered list)
app.post('/updateModelPreferences', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { modelOrder } = req.body;
    
    if (!modelOrder || !Array.isArray(modelOrder)) {
      return res.status(400).json({ 
        success: false, 
        message: 'modelOrder must be an array' 
      });
    }
    
    // Validate that all models in the order are valid (use model ID as unique key)
    const validModelIds = AI_PROVIDER_PREFERENCE.map(p => p.model);
    const invalidModels = modelOrder.filter(modelId => !validModelIds.includes(modelId));
    if (invalidModels.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid models: ${invalidModels.join(', ')}`
      });
    }

    // Ensure all models are present (add missing ones to the end)
    const allModels = [...modelOrder];
    validModelIds.forEach(modelId => {
      if (!allModels.includes(modelId)) {
        allModels.push(modelId);
      }
    });
    
    try {
      const updated = await updateUserModelPreferences(userId, allModels);
      
      if (updated === false) {
        return res.status(202).json({
          success: true,
          modelOrder: allModels,
          warning: 'Preferences updated temporarily but may not persist across sessions'
        });
      }
      
      return res.json({ success: true, modelOrder: allModels });
    } catch (error) {
      console.error('Error updating model preferences:', error);
      return res.status(202).json({ 
        success: true, 
        modelOrder: allModels,
        warning: 'Preferences updated temporarily but may not persist across sessions'
      });
    }
  } catch (error) {
    console.error('Unexpected error in updateModelPreferences endpoint:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Get user's chunk distribution providers (allowed providers for chunked requests)
app.get('/getChunkDistributionProviders', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const providers = await getUserChunkDistributionProviders(userId);
    return res.json({ success: true, providers });
  } catch (error) {
    console.error('Error getting chunk distribution providers:', error);
    const defaultProviders = AI_PROVIDER_PREFERENCE.map(p => p.name);
    return res.json({ success: true, providers: defaultProviders });
  }
});

// Update user's chunk distribution providers
app.post('/updateChunkDistributionProviders', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.uid;
    const { providers } = req.body;

    if (!providers || !Array.isArray(providers) || providers.length === 0) {
      return res.status(400).json({ success: false, message: 'providers must be a non-empty array' });
    }

    const validProviders = AI_PROVIDER_PREFERENCE.map(p => p.name);
    const invalid = providers.filter(p => !validProviders.includes(p));
    if (invalid.length > 0) {
      return res.status(400).json({ success: false, message: `Invalid providers: ${invalid.join(', ')}` });
    }

    const updated = await updateUserChunkDistributionProviders(userId, providers);
    if (updated === false) {
      return res.status(202).json({
        success: true,
        providers,
        warning: 'Preferences updated temporarily but may not persist across sessions'
      });
    }

    return res.json({ success: true, providers });
  } catch (error) {
    console.error('Unexpected error in updateChunkDistributionProviders endpoint:', error);
    return res.status(500).json({ success: false, message: 'Server error', error: error.message });
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
      title: "Medical Clinical Note Generation",
      description: "Used to generate medical-grade clinical notes with realistic medical jargon and abbreviations",
      prompt: "Create a concise, realistic medical clinical note for the following clinical scenario. Use authentic medical terminology and abbreviations as would be used in real UK hospital documentation.\n\nGenerate notes in a format appropriate to the specialty (obstetrics vs gynaecology). Use the examples below as templates for style, structure, and level of clinical detail.\n\nIMPORTANT FORMATTING:\n- Keep the note concise and focused (aim for similar length to examples)\n- CRITICAL: Do NOT put blank lines between every line - this creates excessive spacing\n- Write lines within each section consecutively (one after another with no gaps)\n- Only use ONE blank line to separate major sections (e.g., between Background and Exam sections)\n- Do NOT use markdown headings (###) or bold (**text**)\n- Write in plain text format as it would appear in medical records\n- Match the exact formatting style shown in the examples below\n\n=== OBSTETRIC EXAMPLE ===\n\n34yo, G2P1 (prev SVD with MROP), 39+5, BMI 27, Rh+ve\n\nIssues:\nConcerns regarding anti-D antibodies and potential impact on baby\nPrevious MROP - already counselled re this by obs consultant and advised active 3rd\n\nBackground:\nFetus testing Rh+ve\nLow levels of Anti-D antibodies (0.1 IU/ml) detected on 8th April and 22nd April, likely due to IM injection of Anti-D antibodies, would need to be >4 IU to lead to moderate risk of haemolytic disease\nG&S tests from 20th June pending\n\nAssessment:\nPatient's Anti-D antibody levels remain low, unlikely to pose significant risk to baby\n\nDiscussion:\nHighly likely baby being Rhesus positive based on early pregnancy testing\nUnlikely need for baby's blood typing at birth given known status, yet seemingly is protocol, does need neonatal Hb and bilirubin to check for fetal anaemia\n\nPlan:\nContinue with fortnightly testing of G&S to see if titres rise\nCMW to check results at next ANC appt\nReassure patient regarding low antibody levels and minimal risk to baby\nPlease take FBC and G&S in labour to allow for readily available X-match should MROP and/or PPH occur\nTelephone ANC in 2/52 if still pregnant\n\n=== GYNAECOLOGY EXAMPLE ===\n\n39yo\n\nPresenting Complaint:\nAbnormal uterine bleeding (AUB) – heavy menstrual bleeding (HMB) with intermenstrual bleeding (IMB) for 3/12, worsening over last 2/52\n\nKey Clinical Issue:\nPersistent AUB with associated fatigue (likely secondary to iron deficiency anaemia)\nNo haemodynamic instability at present\n\nBackground:\nG4P2 (2x SVD, 1x LSCS for FTP, 1x TOP)\nPrevious IUD (Mirena) removed 6/12 ago due to expulsion\nNo known fibroids or endometriosis\nHypothyroidism (on levothyroxine 75mcg OD)\nObesity (BMI 32)\n\nSurgical Hx: LSCS (2018), Appendicectomy (2005)\nMedications: Levothyroxine 75mcg OD, NSAIDs PRN for dysmenorrhoea\nAllergies: NKDA\nSocial Hx: Non-smoker, occasional ETOH, works as a teacher\n\nObs:\nBP: 128/78 mmHg, HR: 88 bpm, Temp: 36.7°C, SpO2: 98% RA\n\nExam:\nPale conjunctivae (clinical anaemia)\nAbdomen soft, non-tender, no palpable masses\nPV Exam (consented & chaperoned): No active bleeding, cervix appears normal, no cervical excitation, uterus anteverted, non-tender, normal size, no adnexal masses\n\nInvestigations:\nHb: 98 g/L (↓ from 112 g/L 6/12 ago), MCV: 78 fL (microcytic), Ferritin: 12 μg/L (↓)\nTSH: 2.1 mIU/L (well-controlled), Platelets: 220 x10⁹/L, INR/APTT: Normal\nTV USS: Endometrial thickness 12mm (heterogeneous), no fibroids or polyps seen, normal adnexa\nPipelle biopsy (awaiting histology)\n\nDifferential Diagnosis (PALM-COEIN):\n1. Polyp/Adenomyosis (USS inconclusive, biopsy pending)\n2. Endometrial hyperplasia (↑ risk due to obesity)\n3. Ovulatory dysfunction (secondary to hypothyroidism?)\n\nRECOMMENDATION:\nImmediate Management:\nFerrous sulfate 200mg BD + vitamin C (monitor Hb in 4/52)\nNorethisterone 5mg TDS for 21/7 to regulate bleeding\nConsider Mirena IUD reinsertion if biopsy normal\n\nMonitoring & Follow-Up:\nRepeat Hb in 4/52 (target >110 g/L)\nAwait endometrial biopsy results\nGYN OPD follow-up in 6/52 (consider hysteroscopy if bleeding persists)\n\n=== REQUIREMENTS ===\n\n- Keep the note CONCISE - focus on key clinical information only\n- Use British English spelling (anaemia, haemodynamic, gynaecology, etc.)\n- Use realistic medical abbreviations (G2P1, SVD, LSCS, FTP, TOP, MROP, PPH, ANC, FBC, G&S, USS, TV USS, OPD, etc.)\n- Use plain text format - NO markdown formatting (no ###, no **, no bullets)\n- Within each section, write lines consecutively with NO blank lines between them\n- Only use blank lines to separate major sections (Background from Exam, etc.)\n- Include appropriate demographic information\n- Use specialty-appropriate format (obstetric vs gynaecology structure)\n- Make it clinically authentic with realistic patient scenarios\n- This is for educational/testing purposes only - entirely fictional\n\nClinical scenario: "
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

// Endpoint to get recent endpoint timings for performance monitoring
app.get('/api/endpoint-timings', authenticateUser, async (req, res) => {
    try {
        // Aggregate stats by endpoint
        const endpointStats = {};
        
        endpointTimings.forEach(t => {
            const key = `${t.method} ${t.endpoint}`;
            if (!endpointStats[key]) {
                endpointStats[key] = {
                    method: t.method,
                    endpoint: t.endpoint,
                    count: 0,
                    totalDuration: 0,
                    minDuration: Infinity,
                    maxDuration: 0,
                    lastRequest: null,
                    errorCount: 0
                };
            }
            
            const stats = endpointStats[key];
            stats.count++;
            stats.totalDuration += t.duration;
            stats.minDuration = Math.min(stats.minDuration, t.duration);
            stats.maxDuration = Math.max(stats.maxDuration, t.duration);
            
            if (t.status >= 400) stats.errorCount++;
            
            // Track most recent request
            if (!stats.lastRequest || new Date(t.requestTime) > new Date(stats.lastRequest.requestTime)) {
                stats.lastRequest = t;
            }
        });
        
        // Calculate averages and format
        const aggregatedEndpoints = Object.values(endpointStats).map(stats => ({
            method: stats.method,
            endpoint: stats.endpoint,
            count: stats.count,
            avgDuration: Math.round(stats.totalDuration / stats.count),
            minDuration: stats.minDuration === Infinity ? 0 : stats.minDuration,
            maxDuration: stats.maxDuration,
            errorCount: stats.errorCount,
            errorRate: Math.round((stats.errorCount / stats.count) * 100),
            lastRequest: stats.lastRequest
        }));
        
        // Sort by average duration (slowest first)
        aggregatedEndpoints.sort((a, b) => b.avgDuration - a.avgDuration);
        
        // Calculate overall summary
        const summary = {
            totalRequests: endpointTimings.length,
            uniqueEndpoints: aggregatedEndpoints.length,
            avgDuration: endpointTimings.length > 0 
                ? Math.round(endpointTimings.reduce((sum, t) => sum + t.duration, 0) / endpointTimings.length)
                : 0,
            slowestEndpoints: aggregatedEndpoints.slice(0, 10).map(e => ({
                endpoint: e.endpoint,
                method: e.method,
                avgDuration: e.avgDuration,
                count: e.count
            }))
        };
        
        res.json({
            success: true,
            timings: endpointTimings, // Keep raw timings for detail view
            aggregatedEndpoints, // New: stats per endpoint
            summary
        });
    } catch (error) {
        console.error('Error fetching endpoint timings:', error);
        res.status(500).json({ success: false, error: error.message });
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
                    const status = error.response?.status;
                    const message = error.response?.data?.message || error.message;
                    const errorInfo = {
                        file: file.name,
                        status,
                        message
                    };

                    // Treat 409 conflicts as "already handled/modified" to avoid noisy error logs
                    if (status === 409) {
                        console.warn(`Conflict deleting ${file.name} (likely already modified or removed). Treating as handled.`, errorInfo);
                        return;
                    }

                    deleteResults.failed++;
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

// Generate elegant display name for guidelines
// This function applies more aggressive cleaning than cleanHumanFriendlyName
// to remove UHSx prefixes, hash codes, dates, version numbers, etc.
// AI-powered display name generation
async function generateDisplayNameWithAI(guidelineData, userId) {
  try {
    // Get content for AI analysis
    let contentForAnalysis = guidelineData.condensed || guidelineData.content;
    
    // If no content in Firestore, try to get it from PDF
    if (!contentForAnalysis && guidelineData.filename) {
      try {
        contentForAnalysis = await fetchAndExtractPDFText(guidelineData.filename);
      } catch (pdfError) {
        console.log(`[DISPLAY_NAME_AI] PDF extraction failed: ${pdfError.message}`);
      }
    }
    
    // Get the title/name to use
    const title = guidelineData.humanFriendlyName || guidelineData.title || guidelineData.filename || '';
    
    if (!title) {
      console.log('[DISPLAY_NAME_AI] No title available for AI generation');
      return null;
    }
    
    // Get scope and hospitalTrust for formatting
    const scope = guidelineData.scope || 'national';
    const hospitalTrust = guidelineData.hospitalTrust || '';
    
    // Get the prompt config
    const promptConfig = global.prompts?.['extractDisplayName'] || require('./prompts.json')['extractDisplayName'];
    if (!promptConfig) {
      console.log('[DISPLAY_NAME_AI] No prompt config found for extractDisplayName');
      return null;
    }
    
    // Prepare the prompt with title, scope, trust, and content
    const prompt = promptConfig.prompt
      .replace('{{title}}', title)
      .replace('{{scope}}', scope)
      .replace('{{hospitalTrust}}', hospitalTrust || 'Not specified')
      .replace('{{text}}', (contentForAnalysis || '').substring(0, 2000));
    
    const messages = [
      { role: 'system', content: promptConfig.system_prompt },
      { role: 'user', content: prompt }
    ];
    
    const aiResult = await routeToAI({ messages }, userId);
    
    if (aiResult && aiResult.content) {
      const displayName = aiResult.content.trim();
      // Clean up any extra formatting the AI might add
      const cleaned = displayName.replace(/^["']|["']$/g, '').trim();
      console.log(`[DISPLAY_NAME_AI] Generated: "${cleaned}" from title: "${title}", scope: "${scope}", trust: "${hospitalTrust}"`);
      return cleaned;
    }
    
    return null;
  } catch (error) {
    console.error('[DISPLAY_NAME_AI] Error generating display name with AI:', error);
    return null;
  }
}

// Fallback rule-based display name generation (kept for backward compatibility)
function generateDisplayName(rawName) {
  if (!rawName || typeof rawName !== 'string') {
    return rawName;
  }
  
  // Start with the base cleaning function
  let cleaned = cleanHumanFriendlyName(rawName);
  
  // Remove "UHSx" prefixes (case-insensitive, with optional space after)
  cleaned = cleaned.replace(/^UHSx\s*/i, '');
  
  // Remove hash codes like "UHS-CG-0009-2023" (pattern: UHS-CG-digits-digits)
  cleaned = cleaned.replace(/\bUHS-CG-\d+-\d+\b/gi, '');
  
  // Remove version numbers in various formats (v0.0.1, V2, v1.2.3, etc.)
  cleaned = cleaned.replace(/\s+v\d+(\.\d+)*(\.\d+)?\b/gi, '');
  cleaned = cleaned.replace(/\s+V\d+\b/g, '');
  cleaned = cleaned.replace(/\s+version\s+\d+(\.\d+)?/gi, '');
  
  // Remove dates in various formats (2020-10, 2011v2, etc.)
  cleaned = cleaned.replace(/\b\d{4}-\d{1,2}\b/g, ''); // YYYY-MM format
  cleaned = cleaned.replace(/\b\d{4}v\d+\b/gi, ''); // YYYYvN format
  cleaned = cleaned.replace(/\b\d{4}\s+\d{1,2}\b/g, ''); // YYYY MM format
  
  // Remove "Appendix X" prefixes (case-insensitive)
  cleaned = cleaned.replace(/^Appendix\s+\d+\s+/i, '');
  
  // Remove "Proforma" suffixes (case-insensitive, with optional text before)
  cleaned = cleaned.replace(/\s+Proforma\s*$/i, '');
  cleaned = cleaned.replace(/\s+-\s*Proforma\s*$/i, '');
  
  // Remove common suffixes like "FINAL", "DRAFT", etc.
  cleaned = cleaned.replace(/\s+(FINAL|DRAFT|REVISED|UPDATED)\s*$/i, '');
  
  // Remove parenthetical hash codes and reference codes
  cleaned = cleaned.replace(/\s*\([^)]*UHS[^)]*\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*CG-\d+[^)]*\)/gi, '');
  
  // Remove standalone reference codes (e.g., "PID Proforma - June 2011v2")
  cleaned = cleaned.replace(/\b(PID|GAU|MP|CG|SP|MD|GP)\s+Proforma\s*/gi, '');
  
  // Fix capitalization - Title Case for main words, lowercase for articles/prepositions
  // List of words that should be lowercase (unless first word)
  const lowercaseWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 
                          'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with'];
  
  // Known medical acronyms that should always be uppercase (even if they appear lowercase in source)
  const knownAcronyms = new Set([
    'BJOG', 'RCOG', 'NICE', 'FSRH', 'BASHH', 'BMS', 'BSH', 'BHIVA', 'BAPM', 'BSGE', 'BSUG', 
    'BGCS', 'BSCCP', 'BFS', 'BMFMS', 'BritSPAG', 'ESHRE', 'FIGO', 'ACOG', 'WHO', 'UKMEC', 
    'UK NSC', 'COCP', 'POP', 'IUD', 'IUS', 'PID', 'HIV', 'VTE', 'PPH', 'APH', 'VBAC', 
    'CS', 'LSCS', 'ECV', 'CTG', 'NIPE', 'FGM', 'GTD', 'OHSS', 'PCOS', 'PMS', 'PMRT'
  ]);
  
  // Split into words and capitalize appropriately
  const words = cleaned.split(/\s+/);
  const titleCased = words.map((word, index) => {
    if (word.length === 0) return word;
    
    // Check if this is a known acronym (case-insensitive match)
    const upperWord = word.toUpperCase();
    if (knownAcronyms.has(upperWord)) {
      return upperWord; // Convert to all caps if it's a known acronym
    }
    
    // Preserve acronyms (words that are all caps and at least 2 characters)
    // Common medical acronyms: BJOG, RCOG, NICE, FSRH, BASHH, BMS, BSH, BHIVA, BAPM, etc.
    if (word.length >= 2 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
      return word; // Keep acronyms as-is
    }
    
    // Always capitalize first word
    if (index === 0) {
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }
    
    // Lowercase articles/prepositions unless they're acronyms (all caps)
    if (lowercaseWords.includes(word.toLowerCase()) && word !== word.toUpperCase()) {
      return word.toLowerCase();
    }
    
    // Capitalize first letter, lowercase rest
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  
  cleaned = titleCased.join(' ');
  
  // Clean up multiple spaces and normalize spacing
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  // Remove leading/trailing dashes and spaces
  cleaned = cleaned.replace(/^[- ]+|[- ]+$/g, '');
  
  // Ensure first letter is capitalized
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
            await db.collection('guidelines').doc(guidelineId).set(result.updates, { merge: true });
            
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

// Helper function to detect organization from guideline metadata
function detectGuidelineOrganization(guideline) {
    // Check organisation field first
    if (guideline.organisation) {
        const org = guideline.organisation.toUpperCase();
        // Normalize common variations
        if (org.includes('RCOG') || org.includes('ROYAL COLLEGE OF OBSTETRICIANS')) return 'RCOG';
        if (org.includes('NICE')) return 'NICE';
        if (org.includes('SIGN') || org.includes('SCOTTISH INTERCOLLEGIATE')) return 'SIGN';
        if (org.includes('BASHH') || org.includes('BRITISH ASSOCIATION')) return 'BASHH';
        if (org.includes('FSRH') || org.includes('FACULTY OF SEXUAL')) return 'FSRH';
        if (org.includes('WHO') || org.includes('WORLD HEALTH')) return 'WHO';
        if (org.includes('BHIVA')) return 'BHIVA';
        if (org.includes('BAPM')) return 'BAPM';
        if (org.includes('BSH') || org.includes('BRITISH SOCIETY FOR HAEMATOLOGY')) return 'BSH';
        if (org.includes('BJOG')) return 'BJOG';
        return org; // Return as-is if recognized
    }
    
    // Check title/filename patterns
    const title = (guideline.title || guideline.humanFriendlyName || guideline.filename || '').toLowerCase();
    const displayName = (guideline.displayName || '').toLowerCase();
    const combinedText = `${title} ${displayName}`;
    
    // Pattern matching for common organizations
    if (combinedText.includes('nice') || combinedText.includes('ng') || combinedText.includes('cg') && combinedText.includes('nice')) {
        return 'NICE';
    }
    if (combinedText.includes('rcog') || combinedText.includes('green-top') || combinedText.includes('gtg')) {
        return 'RCOG';
    }
    if (combinedText.includes('sign') || combinedText.includes('scottish intercollegiate')) {
        return 'SIGN';
    }
    if (combinedText.includes('bashh') || combinedText.includes('british association for sexual health')) {
        return 'BASHH';
    }
    if (combinedText.includes('fsrh') || combinedText.includes('faculty of sexual and reproductive health')) {
        return 'FSRH';
    }
    if (combinedText.includes('who') || combinedText.includes('world health organization')) {
        return 'WHO';
    }
    if (combinedText.includes('bhiva')) {
        return 'BHIVA';
    }
    if (combinedText.includes('bapm')) {
        return 'BAPM';
    }
    if (combinedText.includes('bsh') || combinedText.includes('british society for haematology')) {
        return 'BSH';
    }
    if (combinedText.includes('bjog')) {
        return 'BJOG';
    }
    
    // Default: return null if cannot detect
    return null;
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

// Core function to enhance guideline metadata (extracted for reuse)
async function enhanceGuidelineMetadataCore(guidelineId, specificFields, userId) {
  console.log(`[DEBUG] Enhancing metadata for guideline: ${guidelineId}`);

  // Get the guideline from Firestore
  const guidelineRef = db.collection('guidelines').doc(guidelineId);
  const guidelineDoc = await guidelineRef.get();

  if (!guidelineDoc.exists) {
    throw new Error('Guideline not found');
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
      'keywords',
      'scope',
      'nation',
      'hospitalTrust'
    ];

    const missingFields = [];
    const incompleteFields = [];
    
    // Check which fields need enhancement
    const fieldsToEnhance = specificFields || metadataFields;
    
    fieldsToEnhance.forEach(field => {
      const value = currentData[field];
      // Special handling for scope fields
      if (field === 'scope') {
        if (!value || (value !== 'national' && value !== 'local')) {
          missingFields.push(field);
        }
      } else if (field === 'nation' || field === 'hospitalTrust') {
        // These are conditional on scope, check if they need to be set
        const scope = currentData.scope;
        
        // If scope doesn't exist yet, we'll need to process these conditionally after scope is determined
        if (!scope) {
          // Add to missingFields so they're considered for processing after scope detection
          if (!value || value === 'N/A' || value === 'Not available' || value === '') {
            missingFields.push(field);
          }
        } else if (field === 'nation' && scope === 'national' && (!value || value === 'N/A' || value === 'Not available' || value === '')) {
          missingFields.push(field);
        } else if (field === 'hospitalTrust' && scope === 'local' && (!value || value === 'N/A' || value === 'Not available' || value === '')) {
          missingFields.push(field);
        }
      } else {
        // Standard field validation
        if (!value || value === 'N/A' || value === 'Not available' || value === '') {
          missingFields.push(field);
        } else if (typeof value === 'string' && value.length < 3) {
          incompleteFields.push(field);
        }
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
      'summary': 'extractSummary',
      'keywords': 'extractKeywords',
      'scope': 'extractPublisherType',
      'nation': 'extractNation',
      'hospitalTrust': 'extractHospitalTrust'
    };

    // Process scope first, then conditionally process nation/hospitalTrust
    // Scope, nation, and hospitalTrust need special handling
    const scopeFields = ['scope', 'nation', 'hospitalTrust'];
    
    // First, determine scope if needed
    let detectedScope = null;
    if (missingFields.includes('scope') || incompleteFields.includes('scope')) {
      try {
        const promptKey = fieldPromptMapping['scope'];
        const promptConfig = loadedPrompts[promptKey];
        if (promptConfig) {
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
          
          console.log(`[DEBUG] Calling AI for scope detection`);
          const aiResult = await routeToAI({ messages }, userId);
          
          if (aiResult && aiResult.content) {
            detectedScope = aiResult.content.trim().toLowerCase();
            // Normalize to 'national' or 'local'
            if (detectedScope.includes('local')) {
              detectedScope = 'local';
            } else if (detectedScope.includes('national')) {
              detectedScope = 'national';
            } else {
              detectedScope = 'national'; // Default
            }
            
            enhancedData.scope = detectedScope;
            enhancedFields.push({
              field: 'scope',
              oldValue: currentData.scope || null,
              newValue: detectedScope,
              action: missingFields.includes('scope') ? 'added' : 'enhanced'
            });
            console.log(`[DEBUG] Successfully detected scope: "${detectedScope}"`);
          }
        }
      } catch (error) {
        console.error(`[DEBUG] Error processing scope:`, error);
        errors.push(`Error processing scope: ${error.message}`);
      }
    } else {
      // Use existing scope if available
      detectedScope = currentData.scope;
    }
    
    // Process nation if scope is national
    if (detectedScope === 'national' && (missingFields.includes('nation') || incompleteFields.includes('nation'))) {
      try {
        const promptKey = fieldPromptMapping['nation'];
        const promptConfig = loadedPrompts[promptKey];
        if (promptConfig) {
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
          
          console.log(`[DEBUG] Calling AI for nation detection`);
          const aiResult = await routeToAI({ messages }, userId);
          
          if (aiResult && aiResult.content) {
            let nation = aiResult.content.trim();
            // Validate nation value
            const validNations = ['England & Wales', 'Scotland', 'Northern Ireland'];
            if (!validNations.includes(nation)) {
              // Try to normalize
              if (nation.toLowerCase().includes('scotland')) {
                nation = 'Scotland';
              } else if (nation.toLowerCase().includes('northern ireland')) {
                nation = 'Northern Ireland';
              } else {
                nation = 'England & Wales'; // Default
              }
            }
            
            enhancedData.nation = nation;
            enhancedFields.push({
              field: 'nation',
              oldValue: currentData.nation || null,
              newValue: nation,
              action: missingFields.includes('nation') ? 'added' : 'enhanced'
            });
            console.log(`[DEBUG] Successfully detected nation: "${nation}"`);
          }
        }
      } catch (error) {
        console.error(`[DEBUG] Error processing nation:`, error);
        errors.push(`Error processing nation: ${error.message}`);
      }
    }
    
    // Process hospitalTrust if scope is local
    if (detectedScope === 'local' && (missingFields.includes('hospitalTrust') || incompleteFields.includes('hospitalTrust'))) {
      try {
        const promptKey = fieldPromptMapping['hospitalTrust'];
        const promptConfig = loadedPrompts[promptKey];
        if (promptConfig) {
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
          
          console.log(`[DEBUG] Calling AI for hospitalTrust detection`);
          const aiResult = await routeToAI({ messages }, userId);
          
          if (aiResult && aiResult.content) {
            let hospitalTrust = aiResult.content.trim();
            
            // Validate - don't use cleanHumanFriendlyName for trust names as they may contain special characters
            if (hospitalTrust && 
                hospitalTrust !== 'N/A' && 
                hospitalTrust !== 'Not available' && 
                hospitalTrust !== 'Unknown' &&
                hospitalTrust.length > 2) {
              
              enhancedData.hospitalTrust = hospitalTrust;
              enhancedFields.push({
                field: 'hospitalTrust',
                oldValue: currentData.hospitalTrust || null,
                newValue: hospitalTrust,
                action: missingFields.includes('hospitalTrust') ? 'added' : 'enhanced'
              });
              console.log(`[DEBUG] Successfully detected hospitalTrust: "${hospitalTrust}"`);
            }
          }
        }
      } catch (error) {
        console.error(`[DEBUG] Error processing hospitalTrust:`, error);
        errors.push(`Error processing hospitalTrust: ${error.message}`);
      }
    }
    
    // Process other fields (non-scope fields)
    const fieldsToProcess = [...missingFields, ...incompleteFields].filter(f => !scopeFields.includes(f));
    
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

    // Return result
    return {
      success: true,
      message: `Enhanced ${enhancedFields.length} field(s) for guideline ${guidelineId}`,
      enhancedFields,
      errors: errors.length > 0 ? errors : undefined,
      guidelineData: enhancedData
    };
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

    const result = await enhanceGuidelineMetadataCore(guidelineId, specificFields, userId);
    res.json(result);

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
          // Call the core enhancement function directly
          const result = await enhanceGuidelineMetadataCore(guidelineId, fieldsToEnhance, userId);
          
          return {
            guidelineId,
            success: result.success,
            enhancedFields: result.enhancedFields || [],
            errors: result.errors || [],
            message: result.message
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
            
            // Start background scanner for incomplete guidelines
            startBackgroundScanner();
            
        } catch (error) {
            console.error('Background GitHub checks failed:', error.message);
            console.log('Server will continue to operate with limited GitHub functionality');
            
            // Still start background scanner even if GitHub checks fail
            startBackgroundScanner();
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

// Server status endpoint for cold start detection
// Returns whether the guidelines cache is ready (for client warmup indicators)
app.get('/serverStatus', (req, res) => {
    res.status(200).json({
        ready: guidelinesCacheReady,
        uptime: Math.round(process.uptime()),
        cachePopulated: guidelinesCache.data !== null,
        guidelinesCount: guidelinesCache.data?.length || 0,
        timestamp: new Date().toISOString()
    });
});

// Test all 5 AI models with minimal tokens (health check)
// Cost: < $0.0001 total (fraction of a cent)
app.get('/testModelHealth', authenticateUser, async (req, res) => {
    const MODELS = [
        { name: 'DeepSeek', model: 'deepseek-chat', endpoint: 'https://api.deepseek.com/v1/chat/completions', keyEnv: 'DEEPSEEK_API_KEY' },
        { name: 'Mistral', model: 'mistral-large-latest', endpoint: 'https://api.mistral.ai/v1/chat/completions', keyEnv: 'MISTRAL_API_KEY' },
        { name: 'Anthropic', model: 'claude-3-haiku-20240307', endpoint: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY' },
        { name: 'OpenAI', model: 'gpt-3.5-turbo', endpoint: 'https://api.openai.com/v1/chat/completions', keyEnv: 'OPENAI_API_KEY' },
        { name: 'Gemini', model: 'gemini-2.5-flash', endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', keyEnv: 'GOOGLE_AI_API_KEY' },
        { name: 'Groq', model: 'llama-3.3-70b-versatile', endpoint: 'https://api.groq.com/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY' }
    ];

    const MINIMAL_PROMPT = 'Say OK';

    async function testModel(modelConfig) {
        const { name, model, endpoint, keyEnv } = modelConfig;
        const apiKey = process.env[keyEnv];

        if (!apiKey) {
            return { name, status: 'SKIP', message: `No ${keyEnv} configured`, ms: 0 };
        }

        const startTime = Date.now();

        try {
            let response;

            if (name === 'Anthropic') {
                response = await axios.post(endpoint, {
                    model,
                    messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                    max_tokens: 10
                }, {
                    headers: {
                        'x-api-key': apiKey,
                        'Content-Type': 'application/json',
                        'anthropic-version': '2023-06-01'
                    },
                    timeout: 15000
                });
            } else if (name === 'Gemini') {
                const url = `${endpoint}?key=${apiKey}`;
                response = await axios.post(url, {
                    contents: [{ parts: [{ text: MINIMAL_PROMPT }] }],
                    generationConfig: { maxOutputTokens: 10 }
                }, {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 15000
                });
            } else {
                // OpenAI, DeepSeek, Mistral all use the same format
                response = await axios.post(endpoint, {
                    model,
                    messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                    max_tokens: 10
                }, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });
            }

            const ms = Date.now() - startTime;

            // Extract response content
            let content = '';
            if (name === 'Anthropic') {
                content = response.data?.content?.[0]?.text || '';
            } else if (name === 'Gemini') {
                content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                content = response.data?.choices?.[0]?.message?.content || '';
            }

            return { name, status: 'OK', message: content.trim().substring(0, 30), ms };

        } catch (error) {
            const ms = Date.now() - startTime;
            const errMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
            return { name, status: 'FAIL', message: (errMsg || 'Unknown error').substring(0, 80), ms };
        }
    }

    try {
        console.log(`[MODEL_HEALTH] User ${req.user.uid} requested model health check`);

        // Test all models in parallel
        const results = await Promise.all(MODELS.map(testModel));

        const passCount = results.filter(r => r.status === 'OK').length;
        const failCount = results.filter(r => r.status === 'FAIL').length;
        const skipCount = results.filter(r => r.status === 'SKIP').length;

        console.log(`[MODEL_HEALTH] Results: ${passCount} OK, ${failCount} FAIL, ${skipCount} SKIP`);

        res.json({
            success: true,
            timestamp: new Date().toISOString(),
            results,
            summary: {
                passed: passCount,
                failed: failCount,
                skipped: skipCount,
                total: MODELS.length
            }
        });
    } catch (error) {
        console.error('[MODEL_HEALTH] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error running model health check: ' + error.message
        });
    }
});

// Get the full model registry with API key availability
app.get('/getModelRegistry', authenticateUser, async (req, res) => {
    try {
        const registry = {};
        
        for (const [providerName, providerData] of Object.entries(AI_MODEL_REGISTRY)) {
            const hasApiKey = !!process.env[providerData.keyEnv];
            registry[providerName] = {
                hasApiKey,
                endpoint: providerData.endpoint,
                models: providerData.models.map(m => ({
                    ...m,
                    available: hasApiKey
                }))
            };
        }
        
        res.json({
            success: true,
            registry,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[MODEL_REGISTRY] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching model registry: ' + error.message
        });
    }
});

// Test a single model with minimal tokens
app.post('/testModel', authenticateUser, async (req, res) => {
    const { provider, model } = req.body;
    
    if (!provider || !model) {
        return res.status(400).json({
            success: false,
            message: 'Provider and model are required'
        });
    }
    
    const providerData = AI_MODEL_REGISTRY[provider];
    if (!providerData) {
        return res.status(400).json({
            success: false,
            message: `Unknown provider: ${provider}`
        });
    }
    
    const modelData = providerData.models.find(m => m.model === model);
    if (!modelData) {
        return res.status(400).json({
            success: false,
            message: `Unknown model: ${model} for provider ${provider}`
        });
    }
    
    const apiKey = process.env[providerData.keyEnv];
    if (!apiKey) {
        return res.json({
            success: true,
            provider,
            model,
            status: 'SKIP',
            message: `No ${providerData.keyEnv} configured`,
            ms: 0
        });
    }
    
    const MINIMAL_PROMPT = 'Say OK';
    const startTime = Date.now();
    
    try {
        let response;
        let endpoint = providerData.endpoint;
        
        if (provider === 'Anthropic') {
            response = await axios.post(endpoint, {
                model,
                messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                max_tokens: 10
            }, {
                headers: {
                    'x-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'anthropic-version': '2023-06-01'
                },
                timeout: 30000
            });
        } else if (provider === 'Gemini') {
            const url = `${endpoint}/${model}:generateContent?key=${apiKey}`;
            response = await axios.post(url, {
                contents: [{ parts: [{ text: MINIMAL_PROMPT }] }],
                generationConfig: { maxOutputTokens: 10 }
            }, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });
        } else {
            // OpenAI, DeepSeek, Mistral all use the same format
            response = await axios.post(endpoint, {
                model,
                messages: [{ role: 'user', content: MINIMAL_PROMPT }],
                max_tokens: 10
            }, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            });
        }
        
        const ms = Date.now() - startTime;
        
        // Extract response content
        let content = '';
        if (provider === 'Anthropic') {
            content = response.data?.content?.[0]?.text || '';
        } else if (provider === 'Gemini') {
            content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else {
            content = response.data?.choices?.[0]?.message?.content || '';
        }
        
        console.log(`[TEST_MODEL] ${provider}/${model} OK in ${ms}ms`);
        
        res.json({
            success: true,
            provider,
            model,
            status: 'OK',
            message: content.trim().substring(0, 50),
            ms
        });
        
    } catch (error) {
        const ms = Date.now() - startTime;
        const errMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
        
        console.error(`[TEST_MODEL] ${provider}/${model} FAIL after ${ms}ms:`, errMsg);
        
        res.json({
            success: true,
            provider,
            model,
            status: 'FAIL',
            message: (errMsg || 'Unknown error').substring(0, 100),
            ms
        });
    }
});

// Get AI usage statistics from Firestore
app.get('/getAIUsageStats', authenticateUser, async (req, res) => {
    try {
        const { timeRange = '24h', provider, model } = req.query;
        
        // Calculate start date based on time range
        const now = new Date();
        let startDate;
        switch (timeRange) {
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '24h':
            default:
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }
        
        // Build Firestore query
        let query = db.collection('aiInteractions')
            .where('timestamp', '>=', startDate)
            .orderBy('timestamp', 'desc')
            .limit(500);
        
        const snapshot = await query.get();
        
        const interactions = [];
        const aggregated = {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0,
            avgLatency: 0,
            byProvider: {},
            byModel: {},
            byHour: {}
        };
        
        let totalLatency = 0;
        
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Apply filters if provided
            if (provider && data.provider !== provider) return;
            if (model && data.model !== model) return;
            
            interactions.push({
                id: doc.id,
                ...data,
                timestamp: data.timestamp?.toDate?.() || data.timestamp
            });
            
            // Aggregate stats
            aggregated.totalRequests++;
            aggregated.totalTokens += data.totalTokens || 0;
            aggregated.totalCost += data.estimatedCostUsd || 0;
            totalLatency += data.latencyMs || 0;
            
            // By provider
            if (!aggregated.byProvider[data.provider]) {
                aggregated.byProvider[data.provider] = {
                    requests: 0,
                    tokens: 0,
                    cost: 0,
                    avgLatency: 0,
                    totalLatency: 0
                };
            }
            aggregated.byProvider[data.provider].requests++;
            aggregated.byProvider[data.provider].tokens += data.totalTokens || 0;
            aggregated.byProvider[data.provider].cost += data.estimatedCostUsd || 0;
            aggregated.byProvider[data.provider].totalLatency += data.latencyMs || 0;
            
            // By model
            const modelKey = `${data.provider}/${data.model}`;
            if (!aggregated.byModel[modelKey]) {
                aggregated.byModel[modelKey] = {
                    provider: data.provider,
                    model: data.model,
                    requests: 0,
                    tokens: 0,
                    cost: 0,
                    avgLatency: 0,
                    totalLatency: 0
                };
            }
            aggregated.byModel[modelKey].requests++;
            aggregated.byModel[modelKey].tokens += data.totalTokens || 0;
            aggregated.byModel[modelKey].cost += data.estimatedCostUsd || 0;
            aggregated.byModel[modelKey].totalLatency += data.latencyMs || 0;
            
            // By hour (for time series)
            const hour = data.timestamp?.toDate?.() || new Date(data.timestamp);
            if (hour instanceof Date && !isNaN(hour)) {
                const hourKey = hour.toISOString().substring(0, 13) + ':00:00Z';
                if (!aggregated.byHour[hourKey]) {
                    aggregated.byHour[hourKey] = { requests: 0, tokens: 0, cost: 0 };
                }
                aggregated.byHour[hourKey].requests++;
                aggregated.byHour[hourKey].tokens += data.totalTokens || 0;
                aggregated.byHour[hourKey].cost += data.estimatedCostUsd || 0;
            }
        });
        
        // Calculate averages
        if (aggregated.totalRequests > 0) {
            aggregated.avgLatency = Math.round(totalLatency / aggregated.totalRequests);
        }
        
        for (const p of Object.values(aggregated.byProvider)) {
            if (p.requests > 0) {
                p.avgLatency = Math.round(p.totalLatency / p.requests);
            }
            delete p.totalLatency;
        }
        
        for (const m of Object.values(aggregated.byModel)) {
            if (m.requests > 0) {
                m.avgLatency = Math.round(m.totalLatency / m.requests);
            }
            delete m.totalLatency;
        }
        
        // Convert byHour to sorted array for charting
        const timeSeries = Object.entries(aggregated.byHour)
            .map(([hour, data]) => ({ hour, ...data }))
            .sort((a, b) => a.hour.localeCompare(b.hour));
        
        res.json({
            success: true,
            timeRange,
            startDate: startDate.toISOString(),
            endDate: now.toISOString(),
            aggregated: {
                ...aggregated,
                byHour: undefined // Remove from main object, use timeSeries instead
            },
            timeSeries,
            recentLogs: interactions.slice(0, 100), // Return most recent 100
            totalLogsInRange: interactions.length
        });
        
    } catch (error) {
        console.error('[AI_USAGE_STATS] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching AI usage stats: ' + error.message
        });
    }
});

// Get recent AI logs with full prompt/response content for debugging
app.get('/getRecentAILogs', authenticateUser, async (req, res) => {
    try {
        const { 
            limit = 50, 
            timeRange = '1h', 
            endpoint = null,
            provider = null,
            successOnly = null,
            search = null
        } = req.query;
        
        // Calculate start date based on time range
        const now = new Date();
        let startDate;
        switch (timeRange) {
            case '15m':
                startDate = new Date(now.getTime() - 15 * 60 * 1000);
                break;
            case '1h':
                startDate = new Date(now.getTime() - 60 * 60 * 1000);
                break;
            case '6h':
                startDate = new Date(now.getTime() - 6 * 60 * 60 * 1000);
                break;
            case '24h':
                startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                break;
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 60 * 60 * 1000); // Default 1 hour
        }
        
        // Build Firestore query
        let query = db.collection('aiInteractions')
            .where('timestamp', '>=', startDate)
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit, 10) || 50);
        
        const snapshot = await query.get();
        
        const logs = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            
            // Apply endpoint filter if provided
            if (endpoint && endpoint !== 'all' && data.endpoint !== endpoint) return;
            
            // Apply provider filter if provided
            if (provider && provider !== 'all' && data.provider !== provider) return;
            
            // Apply success filter if provided
            if (successOnly === 'true' && !data.success) return;
            if (successOnly === 'false' && data.success) return;
            
            // Apply search filter if provided (search in prompt and response)
            if (search && search.trim()) {
                const searchLower = search.toLowerCase();
                const promptMatch = data.fullPrompt?.toLowerCase().includes(searchLower);
                const responseMatch = data.fullResponse?.toLowerCase().includes(searchLower);
                const endpointMatch = data.endpoint?.toLowerCase().includes(searchLower);
                if (!promptMatch && !responseMatch && !endpointMatch) return;
            }
            
            logs.push({
                id: doc.id,
                timestamp: data.timestamp?.toDate?.()?.toISOString() || data.timestamp,
                provider: data.provider,
                model: data.model,
                endpoint: data.endpoint,
                success: data.success,
                errorMessage: data.errorMessage,
                promptTokens: data.promptTokens || 0,
                completionTokens: data.completionTokens || 0,
                totalTokens: data.totalTokens || 0,
                latencyMs: data.latencyMs || 0,
                estimatedCostUsd: data.estimatedCostUsd || 0,
                promptLength: data.promptLength || 0,
                responseLength: data.responseLength || 0,
                fullPrompt: data.fullPrompt || null,
                fullResponse: data.fullResponse || null,
                fallbackFrom: data.fallbackFrom || null
            });
        });
        
        // Get unique endpoints and providers for filter dropdowns
        const uniqueEndpoints = [...new Set(logs.map(l => l.endpoint).filter(Boolean))].sort();
        const uniqueProviders = [...new Set(logs.map(l => l.provider).filter(Boolean))].sort();
        
        res.json({
            success: true,
            logs,
            totalCount: logs.length,
            timeRange,
            startDate: startDate.toISOString(),
            endDate: now.toISOString(),
            filters: {
                endpoints: uniqueEndpoints,
                providers: uniqueProviders
            }
        });
        
    } catch (error) {
        console.error('[GET_RECENT_AI_LOGS] Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching recent AI logs: ' + error.message
        });
    }
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
    debugLog('[DEBUG] /getGuidelineContent called with body:', {
        filename: req.body.filename,
        userId: req.user.uid
    });

    try {
        const { filename } = req.body;
        if (!filename) {
            debugLog('[DEBUG] Missing filename in request');
            return res.status(400).json({ success: false, message: 'Filename is required' });
        }

        // Get the file path for the guideline - use the filename as is
        const filePath = `guidance/condensed/${filename}`;
        debugLog('[DEBUG] Looking for guideline at path:', filePath);
        
        // Verify the file exists
        debugLog('[DEBUG] Checking if file exists...');
        const fileExists = await checkFolderExists(filePath);
        if (!fileExists) {
            debugLog('[DEBUG] File not found at path:', filePath);
            return res.status(404).json({ success: false, message: 'Guideline not found' });
        }
        debugLog('[DEBUG] File exists, proceeding to read contents');

        // Get the file contents
        debugLog('[DEBUG] Attempting to read file contents...');
        const content = await getFileContents(filePath);
        if (!content) {
            debugLog('[DEBUG] Failed to read file contents');
            return res.status(404).json({ success: false, message: 'Could not read guideline content' });
        }
        debugLog('[DEBUG] Successfully read file contents, length:', content.length);

        res.json({ success: true, content });
        debugLog('[DEBUG] Successfully sent guideline content response');
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
    debugLog('[DEBUG] /getRecommendations called with body:', {
        noteLength: req.body.note?.length,
        guidelineLength: req.body.guideline?.length,
        promptType: req.body.promptType,
        userId: req.user.uid
    });

    try {
        const { note, guideline, promptType } = req.body;
        if (!note || !guideline || !promptType) {
            debugLog('[DEBUG] Missing required fields:', {
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
        debugLog('[DEBUG] Getting AI recommendations for user:', userId);
        
        // Prepare the prompt
        const prompt = `Note: ${note}\n\nGuideline: ${guideline}`;
        debugLog('[DEBUG] Sending prompt to AI, length:', prompt.length);

        const aiResult = await routeToAI(prompt, userId);
        debugLog('[DEBUG] Received AI response:', {
            success: aiResult.success,
            provider: aiResult.provider,
            contentLength: aiResult.content?.length
        });

        if (!aiResult.success) {
            debugLog('[DEBUG] AI request failed:', aiResult.message);
            throw new Error(aiResult.message || 'Failed to get AI recommendations');
        }

        // Log the interaction
        debugLog('[DEBUG] Logging AI interaction...');
        await logAIInteraction(prompt, aiResult.content, 'getRecommendations');
        debugLog('[DEBUG] Successfully logged AI interaction');

        res.json({ 
            success: true, 
            recommendations: aiResult.content,
            aiProvider: aiResult.provider
        });
        debugLog('[DEBUG] Successfully sent recommendations response');
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

// In-memory cache for guidelines to reduce Firestore calls
const guidelinesCache = {
    data: null,
    timestamp: null,
    TTL: 5 * 60 * 1000 // 5 minutes
};

// Track if guidelines cache has been populated (for cold start detection)
let guidelinesCacheReady = false;

// Get guidelines from cache or fetch from Firestore
async function getCachedGuidelines() {
    const now = Date.now();
    if (guidelinesCache.data && guidelinesCache.timestamp && 
        (now - guidelinesCache.timestamp) < guidelinesCache.TTL) {
        console.log('[CACHE] Returning cached guidelines:', guidelinesCache.data.length, 'guidelines');
        return guidelinesCache.data;
    }
    
    debugLog('[CACHE] Cache miss or expired, fetching from Firestore...');
    const guidelines = await getAllGuidelines();
    guidelinesCache.data = guidelines;
    guidelinesCache.timestamp = now;
    guidelinesCacheReady = guidelines.length > 0; // Mark cache as ready when populated
    console.log('[CACHE] Guidelines cached:', guidelines.length, 'guidelines, cacheReady:', guidelinesCacheReady);
    return guidelines;
}

// Function to invalidate guidelines cache (call after updates)
function invalidateGuidelinesCache() {
    guidelinesCache.data = null;
    guidelinesCache.timestamp = null;
    guidelinesCacheReady = false; // Reset ready flag when cache is invalidated
    console.log('[CACHE] Guidelines cache invalidated');
}

async function getAllGuidelines() {
  try {
    // debugLog('[DEBUG] getAllGuidelines function called');
    
    // Check if database is available
    if (!db) {
      debugLog('[DEBUG] Firestore database not available, returning empty guidelines');
      return [];
    }

    debugLog('[DEBUG] Fetching guidelines collections from Firestore');
    
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

    // debugLog('[DEBUG] Collection sizes:', {
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
    debugLog('[DEBUG] Returning', result.length, 'guidelines');
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
      debugLog('[DEBUG] Returning empty guidelines due to authentication/connectivity issues');
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

    debugLog('[DEBUG] Admin user authorized for sync:', req.user.email);

    // Get all guidelines from GitHub
    const guidelines = await getGuidelinesList();
        debugLog('[DEBUG] Found guidelines in GitHub:', guidelines.length);
    
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
    const prompt = `You are a clinical guideline auditor. Your task is to extract clinically relevant auditable elements from this guideline with detailed variation points and thresholds.

CRITICAL REQUIREMENTS:
1. Parse the guideline carefully to identify ALL clinically relevant advice
2. Order elements by clinical significance (most significant first)
3. No upper limit on number of elements
4. Each element must describe:
   - Input variables/conditions that determine the advice
   - The derived clinical advice/action
   - Clinical context and reasoning
   - Specific thresholds that change recommendations
   - Variation points where subtle changes should alter guidance

OUTPUT FORMAT:
Return a JSON array of objects, each with:
{
  "type": "clinical_advice",
  "elementId": "unique-id-format",
  "name": "Brief description of the clinical decision point",
  "element": "Detailed description including input variables and derived advice",
  "significance": "high|medium|low",
  "inputVariables": [
    {
      "name": "variable_name",
      "type": "numeric|boolean|categorical|text",
      "description": "What this variable represents",
      "required": true|false,
      "threshold": "e.g., >=26 weeks, >100 mmHg, etc.",
      "thresholdDescription": "What happens at this threshold",
      "variationPoints": ["point1", "point2"]
    }
  ],
  "derivedAdvice": "The specific clinical action/advice",
  "expectedGuidance": "Exact guidance text or acceptable variations",
  "variationPoints": [
    {
      "parameter": "variable_name",
      "description": "What changes at this point",
      "belowThreshold": "Guidance when below threshold",
      "atThreshold": "Guidance at threshold",
      "aboveThreshold": "Guidance when above threshold"
    }
  ],
  "thresholds": [
    {
      "variable": "variable_name",
      "thresholdValue": "26+0 weeks",
      "comparison": ">=",
      "impact": "Changes recommendation from X to Y"
    }
  ],
  "clinicalContext": {
    "requiredFactors": ["factor1", "factor2"],
    "contraindications": ["condition1", "condition2"],
    "patientDemographics": "Any relevant demographic requirements"
  },
  "guidelineSection": "Section reference if available"
}

EXAMPLE:
{
  "type": "clinical_advice",
  "elementId": "rfm-ctg-26weeks",
  "name": "CTG monitoring for reduced fetal movements at 26+ weeks",
  "element": "If patient reports reduced fetal movements at 26+0 weeks or later, perform computerized CTG within 2 hours. Input variables: gestational age (≥26+0 weeks), patient report of reduced movements, absence of other risk factors. Derived advice: Immediate CTG monitoring within 2 hours of report.",
  "significance": "high",
  "inputVariables": [
    {
      "name": "gestational_age",
      "type": "numeric",
      "description": "Gestational age in weeks",
      "required": true,
      "threshold": ">=26+0 weeks",
      "thresholdDescription": "Guidance applies from 26+0 weeks gestation",
      "variationPoints": ["<26 weeks: different guidance", ">=26 weeks: CTG required"]
    },
    {
      "name": "fetal_movement_report",
      "type": "boolean",
      "description": "Patient reports reduced fetal movements",
      "required": true,
      "threshold": null,
      "thresholdDescription": "Must be reported by patient",
      "variationPoints": ["Reported: triggers action", "Not reported: no action"]
    }
  ],
  "derivedAdvice": "Perform computerized CTG within 2 hours",
  "expectedGuidance": "Immediate CTG monitoring within 2 hours of report of reduced movements",
  "variationPoints": [
    {
      "parameter": "gestational_age",
      "description": "Age threshold for CTG requirement",
      "belowThreshold": "Different guidance for earlier gestation",
      "atThreshold": "CTG monitoring required",
      "aboveThreshold": "CTG monitoring required"
    }
  ],
  "thresholds": [
    {
      "variable": "gestational_age",
      "thresholdValue": "26+0 weeks",
      "comparison": ">=",
      "impact": "Triggers CTG monitoring requirement"
    }
  ],
  "clinicalContext": {
    "requiredFactors": ["reduced fetal movement report", "gestational age >=26 weeks"],
    "contraindications": [],
    "patientDemographics": "All pregnant patients"
  },
  "guidelineSection": "Antenatal Care - Fetal Movement Monitoring"
}

Guideline content:
${content}

Extract ALL clinically relevant auditable elements, ordered by significance. Focus on actionable clinical decisions that can be audited for accuracy. For each element, identify ALL thresholds, variation points, and input variable specifications.`;

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
        debugLog('[DEBUG] AI response was:', result.content);
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

    debugLog('[DEBUG] Admin user authorized for metadata sync:', req.user.email);

    // Get all guidelines from GitHub
    const guidelinesString = await getGuidelinesList();
    const guidelines = guidelinesString.split('\n').filter(line => line.trim()); // Split into an array of filenames
    const results = [];

    if (!guidelines || guidelines.length === 0) {
        debugLog('[DEBUG] getGuidelinesList returned no guidelines (or the list was empty). Nothing to sync.');
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

        // Extract scope first
        let detectedScope = null;
        try {
          const promptConfig = prompts['extractPublisherType'];
          if (promptConfig) {
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
              detectedScope = result.content.trim().toLowerCase();
              // Normalize to 'national' or 'local'
              if (detectedScope.includes('local')) {
                detectedScope = 'local';
              } else if (detectedScope.includes('national')) {
                detectedScope = 'national';
              } else {
                detectedScope = 'national'; // Default
              }
              metadata.scope = detectedScope;
              console.log(`[SYNC_META] Extracted scope for ${guideline}:`, detectedScope);
            }
          }
        } catch (error) {
          console.error(`[SYNC_META] Failed to extract scope for ${guideline}:`, error);
          detectedScope = 'national'; // Default
          metadata.scope = detectedScope;
        }

        // Extract nation if scope is national
        if (detectedScope === 'national') {
          try {
            const promptConfig = prompts['extractNation'];
            if (promptConfig) {
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
                let nation = result.content.trim();
                // Validate nation value
                const validNations = ['England & Wales', 'Scotland', 'Northern Ireland'];
                if (!validNations.includes(nation)) {
                  // Try to normalize
                  if (nation.toLowerCase().includes('scotland')) {
                    nation = 'Scotland';
                  } else if (nation.toLowerCase().includes('northern ireland')) {
                    nation = 'Northern Ireland';
                  } else {
                    nation = 'England & Wales'; // Default
                  }
                }
                metadata.nation = nation;
                console.log(`[SYNC_META] Extracted nation for ${guideline}:`, nation);
              }
            }
          } catch (error) {
            console.error(`[SYNC_META] Failed to extract nation for ${guideline}:`, error);
          }
        }

        // Extract hospitalTrust if scope is local
        if (detectedScope === 'local') {
          try {
            const promptConfig = prompts['extractHospitalTrust'];
            if (promptConfig) {
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
                const hospitalTrust = result.content.trim();
                if (hospitalTrust && hospitalTrust !== 'N/A' && hospitalTrust !== 'Not available' && hospitalTrust !== 'Unknown') {
                  metadata.hospitalTrust = hospitalTrust;
                  console.log(`[SYNC_META] Extracted hospitalTrust for ${guideline}:`, hospitalTrust);
                }
              }
            }
          } catch (error) {
            console.error(`[SYNC_META] Failed to extract hospitalTrust for ${guideline}:`, error);
          }
        }

        // Extract other metadata fields
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
        const title = metadata.humanFriendlyName || rawGuidelineName;
        const docId = await storeGuideline({
          filename: rawGuidelineName, // Original filename for GitHub reference
          title: title, // Use AI-extracted clean name as main title
          displayName: generateDisplayName(title), // Generate rule-based display name initially, AI will improve it in background
          content: guidelineContent,
          summary: guidelineSummary,
          keywords: extractKeywords(guidelineSummary),
          condensed: guidelineContent,
          humanFriendlyName: metadata.humanFriendlyName || rawGuidelineName, // Clean AI-extracted official title
          humanFriendlyTitle: rawGuidelineName, // Original filename for reference
          yearProduced: metadata.yearProduced,
          organisation: metadata.organisation,
          doi: metadata.doi,
          scope: metadata.scope || 'national',
          nation: metadata.nation || null,
          hospitalTrust: metadata.hospitalTrust || null,
          auditableElements: await extractAuditableElements(guidelineContent)
        });
        
        // Queue AI displayName generation job (content is already available from sync)
        queueJob('generate_display_name', docId);
        
        console.log(`[SYNC_META] Successfully stored ${rawGuidelineName} (ID: ${docId}) in Firestore.`);

        results.push({ guideline: rawGuidelineName, success: true, message: 'Guideline synced successfully', cleanId: docId });
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

// Batch sync endpoint - processes guidelines in small batches to avoid timeout
app.post('/syncGuidelinesBatch', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const batchSize = parseInt(req.body.batchSize) || 5; // Process 5 guidelines at a time by default
    const skipExisting = req.body.skipExisting !== false; // Skip existing guidelines by default

    console.log(`[BATCH_SYNC] Starting batch sync with batch size: ${batchSize}`);

    // Get all guidelines from GitHub
    const guidelinesString = await getGuidelinesList();
    const allGuidelines = guidelinesString.split('\n').filter(line => line.trim());

    if (!allGuidelines || allGuidelines.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No guidelines found in GitHub', 
        processed: 0,
        remaining: 0,
        total: 0
      });
    }

    // Get existing guidelines from Firestore
    const existingGuidelinesSnapshot = await db.collection('guidelines').get();
    const existingIds = new Set();
    existingGuidelinesSnapshot.forEach(doc => {
      existingIds.add(doc.id);
    });

    // Filter to only unsynced guidelines
    const unsyncedGuidelines = [];
    for (const rawName of allGuidelines) {
      const cleanId = generateCleanDocId(rawName);
      if (!existingIds.has(cleanId)) {
        unsyncedGuidelines.push(rawName);
      }
    }

    console.log(`[BATCH_SYNC] Total guidelines: ${allGuidelines.length}, Already synced: ${existingIds.size}, Unsynced: ${unsyncedGuidelines.length}`);

    if (unsyncedGuidelines.length === 0) {
      return res.json({
        success: true,
        message: 'All guidelines already synced',
        processed: 0,
        remaining: 0,
        total: allGuidelines.length,
        alreadySynced: existingIds.size
      });
    }

    // Process only the first batch
    const batch = unsyncedGuidelines.slice(0, batchSize);
    const results = [];

    console.log(`[BATCH_SYNC] Processing ${batch.length} guidelines...`);

    for (const rawGuidelineName of batch) {
      const guideline = encodeURIComponent(rawGuidelineName.trim());
      console.log(`[BATCH_SYNC] Processing: ${rawGuidelineName}`);
      
      try {
        const cleanId = generateCleanDocId(rawGuidelineName);
        
        // Get content and summary paths
        let contentPath, summaryPath;
        if (rawGuidelineName.toLowerCase().endsWith('.pdf')) {
          const baseName = rawGuidelineName.replace(/\.pdf$/i, '');
          contentPath = `guidance/condensed/${encodeURIComponent(baseName + '.txt')}`;
          summaryPath = `guidance/summary/${encodeURIComponent(baseName + '.txt')}`;
        } else {
          contentPath = `guidance/condensed/${encodeURIComponent(rawGuidelineName)}`;
          summaryPath = `guidance/summary/${encodeURIComponent(rawGuidelineName)}`;
        }

        console.log(`[BATCH_SYNC] Fetching content from: ${contentPath}`);
        console.log(`[BATCH_SYNC] Fetching summary from: ${summaryPath}`);

        let content = null;
        let summary = null;

        // Try fetching pre-processed .txt files first
        try {
          const [contentResponse, summaryResponse] = await Promise.all([
            fetch(`https://raw.githubusercontent.com/iannouvel/clerky/main/${contentPath}`, {
              headers: { 
                'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw'
              }
            }),
            fetch(`https://raw.githubusercontent.com/iannouvel/clerky/main/${summaryPath}`, {
              headers: { 
                'Authorization': `token ${process.env.GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw'
              }
            })
          ]);

          if (contentResponse.ok && summaryResponse.ok) {
            content = await contentResponse.text();
            summary = await summaryResponse.text();
            console.log(`[BATCH_SYNC] ✓ Successfully fetched pre-processed .txt files`);
          } else {
            throw new Error(`TXT files not found: content=${contentResponse.status}, summary=${summaryResponse.status}`);
          }
        } catch (txtError) {
          // Fallback to PDF extraction if .txt files don't exist
          console.log(`[BATCH_SYNC] .txt files not available, falling back to PDF extraction for ${rawGuidelineName}`);
          
          if (!rawGuidelineName.toLowerCase().endsWith('.pdf')) {
            throw new Error(`Cannot extract content: file is not a PDF and .txt files are missing`);
          }

          // Extract content from PDF
          console.log(`[BATCH_SYNC] Extracting text from PDF: ${rawGuidelineName}`);
          const fullText = await fetchAndExtractPDFText(rawGuidelineName);
          
          if (!fullText || fullText.trim().length < 100) {
            throw new Error(`Failed to extract meaningful text from PDF`);
          }

          console.log(`[BATCH_SYNC] Successfully extracted ${fullText.length} characters from PDF`);

          // Generate condensed version
          console.log(`[BATCH_SYNC] Generating condensed text...`);
          const condensedText = await generateCondensedText(fullText, null);
          
          if (!condensedText) {
            console.warn(`[BATCH_SYNC] Failed to generate condensed text, using full text`);
            content = fullText;
          } else {
            content = condensedText;
            console.log(`[BATCH_SYNC] ✓ Generated condensed text: ${condensedText.length} characters`);
          }

          // Generate summary using AI
          console.log(`[BATCH_SYNC] Generating summary from extracted text...`);
          try {
            const summaryPrompt = `Please provide a concise summary of this clinical guideline in 2-3 paragraphs:\n\n${content.substring(0, 4000)}`;
            const summaryMessages = [
              { role: 'system', content: 'You are a medical expert creating concise summaries of clinical guidelines.' },
              { role: 'user', content: summaryPrompt }
            ];
            
            const summaryResult = await sendToAI(summaryMessages, 'deepseek-chat', null, null);
            
            if (summaryResult && summaryResult.content) {
              summary = summaryResult.content.trim();
              console.log(`[BATCH_SYNC] ✓ Generated summary: ${summary.length} characters`);
            } else {
              // Fallback to first 500 characters as summary
              summary = content.substring(0, 500) + '...';
              console.warn(`[BATCH_SYNC] Failed to generate AI summary, using truncated text`);
            }
          } catch (summaryError) {
            console.error(`[BATCH_SYNC] Error generating summary:`, summaryError.message);
            summary = content.substring(0, 500) + '...';
          }

          console.log(`[BATCH_SYNC] ✓ PDF extraction and content generation complete`);
        }

        console.log(`[BATCH_SYNC] Extracting metadata for ${guideline}...`);

        // Extract metadata using AI (this is the slow part)
        const metadata = {};
        
        // Extract scope first
        let detectedScope = null;
        try {
          const promptConfig = prompts['extractPublisherType'];
          if (promptConfig) {
            const extractPrompt = promptConfig.prompt.replace('{{text}}', content);
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
              detectedScope = result.content.trim().toLowerCase();
              // Normalize to 'national' or 'local'
              if (detectedScope.includes('local')) {
                detectedScope = 'local';
              } else if (detectedScope.includes('national')) {
                detectedScope = 'national';
              } else {
                detectedScope = 'national'; // Default
              }
              metadata.scope = detectedScope;
              console.log(`[BATCH_SYNC] Extracted scope for ${guideline}:`, detectedScope);
            }
          }
        } catch (error) {
          console.error(`[BATCH_SYNC] Failed to extract scope for ${guideline}:`, error.message);
          detectedScope = 'national'; // Default
          metadata.scope = detectedScope;
        }

        // Extract nation if scope is national
        if (detectedScope === 'national') {
          try {
            const promptConfig = prompts['extractNation'];
            if (promptConfig) {
              const extractPrompt = promptConfig.prompt.replace('{{text}}', content);
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
                let nation = result.content.trim();
                // Validate nation value
                const validNations = ['England & Wales', 'Scotland', 'Northern Ireland'];
                if (!validNations.includes(nation)) {
                  // Try to normalize
                  if (nation.toLowerCase().includes('scotland')) {
                    nation = 'Scotland';
                  } else if (nation.toLowerCase().includes('northern ireland')) {
                    nation = 'Northern Ireland';
                  } else {
                    nation = 'England & Wales'; // Default
                  }
                }
                metadata.nation = nation;
                console.log(`[BATCH_SYNC] Extracted nation for ${guideline}:`, nation);
              }
            }
          } catch (error) {
            console.error(`[BATCH_SYNC] Failed to extract nation for ${guideline}:`, error.message);
          }
        }

        // Extract hospitalTrust if scope is local
        if (detectedScope === 'local') {
          try {
            const promptConfig = prompts['extractHospitalTrust'];
            if (promptConfig) {
              const extractPrompt = promptConfig.prompt.replace('{{text}}', content);
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
                const hospitalTrust = result.content.trim();
                if (hospitalTrust && hospitalTrust !== 'N/A' && hospitalTrust !== 'Not available' && hospitalTrust !== 'Unknown') {
                  metadata.hospitalTrust = hospitalTrust;
                  console.log(`[BATCH_SYNC] Extracted hospitalTrust for ${guideline}:`, hospitalTrust);
                }
              }
            }
          } catch (error) {
            console.error(`[BATCH_SYNC] Failed to extract hospitalTrust for ${guideline}:`, error.message);
          }
        }

        // Extract other metadata fields
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
              console.error(`[BATCH_SYNC] Prompt not found for field ${field} (${promptKey})`);
              continue;
            }
            
            const extractPrompt = promptConfig.prompt.replace('{{text}}', content);
            
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
                console.log(`[BATCH_SYNC] Extracted ${field} for ${guideline}: ${extractedValue}`);
              }
            }
          } catch (error) {
            console.error(`[BATCH_SYNC] Failed to extract ${field} for ${guideline}:`, error.message);
          }
        }

        console.log(`[BATCH_SYNC] Successfully extracted metadata for ${rawGuidelineName}:`, metadata);

        // Prepare content for Firestore storage (handles large content)
        console.log(`[BATCH_SYNC] Preparing content for Firestore storage...`);
        const preparedContent = await prepareContentForFirestore(
          content,
          content, // condensed is same as content in this case
          summary,
          cleanId
        );

        // Store in Firestore using the storeGuideline function
        console.log(`[BATCH_SYNC] Storing ${rawGuidelineName} with ID: ${cleanId}`);
        
        const guidelineData = {
          filename: rawGuidelineName,
          title: metadata.humanFriendlyName || rawGuidelineName,
          // Don't include content/condensed/summary if they're in Storage (will be null)
          keywords: extractKeywords(summary || content),
          humanFriendlyName: metadata.humanFriendlyName || rawGuidelineName,
          humanFriendlyTitle: rawGuidelineName,
          yearProduced: metadata.yearProduced,
          organisation: metadata.organisation,
          doi: metadata.doi,
          scope: metadata.scope || 'national',
          nation: metadata.nation || null,
          hospitalTrust: metadata.hospitalTrust || null,
          auditableElements: [] // Skip auditable elements for now to save time
        };
        
        // Add content fields or Storage URLs depending on size
        if (preparedContent.contentStorageUrl) {
          guidelineData.contentStorageUrl = preparedContent.contentStorageUrl;
          guidelineData.contentInStorage = true;
          // Don't add content field - it's in Storage
        } else {
          guidelineData.content = preparedContent.content;
        }
        
        if (preparedContent.condensedStorageUrl) {
          guidelineData.condensedStorageUrl = preparedContent.condensedStorageUrl;
          // Don't add condensed field - it's in Storage
        } else {
          guidelineData.condensed = preparedContent.condensed;
        }
        
        if (preparedContent.summaryStorageUrl) {
          guidelineData.summaryStorageUrl = preparedContent.summaryStorageUrl;
          // Don't add summary field - it's in Storage
        } else {
          guidelineData.summary = preparedContent.summary;
        }
        
        await storeGuideline(guidelineData);

        results.push({ 
          guideline: rawGuidelineName, 
          success: true, 
          id: cleanId,
          message: 'Successfully synced'
        });
        
        console.log(`[BATCH_SYNC] ✓ Successfully synced: ${rawGuidelineName}`);

      } catch (error) {
        console.error(`[BATCH_SYNC] Error processing ${rawGuidelineName}:`, error.message);
        console.error(`[BATCH_SYNC] Error stack:`, error.stack);
        console.error(`[BATCH_SYNC] Full error object:`, JSON.stringify(error, Object.getOwnPropertyNames(error)));
        results.push({ 
          guideline: rawGuidelineName, 
          success: false, 
          error: error.message || 'Unknown error',
          errorDetails: error.toString()
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`[BATCH_SYNC] Batch complete: ${successCount} succeeded, ${failureCount} failed`);

    res.json({
      success: true,
      message: `Processed ${batch.length} guidelines`,
      processed: batch.length,
      succeeded: successCount,
      failed: failureCount,
      remaining: unsyncedGuidelines.length - batch.length,
      total: allGuidelines.length,
      alreadySynced: existingIds.size,
      results: results
    });

  } catch (error) {
    console.error('[BATCH_SYNC] Critical error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Error in batch sync endpoint'
    });
  }
});

// Repair content endpoint - fixes existing guidelines with null content/condensed
app.post('/repairGuidelineContent', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const batchSize = parseInt(req.body.batchSize) || 5; // Process 5 guidelines at a time
    const forceRegenerate = req.body.forceRegenerate || false; // Force regeneration even if content exists

    console.log(`[CONTENT_REPAIR] Starting content repair with batch size: ${batchSize}, force: ${forceRegenerate}`);

    // Query Firestore for guidelines with missing content or condensed fields
    const guidelinesSnapshot = await db.collection('guidelines').get();
    const guidelinesNeedingRepair = [];

    guidelinesSnapshot.forEach(doc => {
      const data = doc.data();
      const hasContent = data.content && data.content.trim().length > 0;
      const hasCondensed = data.condensed && data.condensed.trim().length > 0;
      
      if (forceRegenerate || !hasContent || !hasCondensed) {
        guidelinesNeedingRepair.push({
          id: doc.id,
          data: data,
          missingContent: !hasContent,
          missingCondensed: !hasCondensed
        });
      }
    });

    console.log(`[CONTENT_REPAIR] Found ${guidelinesNeedingRepair.length} guidelines needing repair`);

    if (guidelinesNeedingRepair.length === 0) {
      return res.json({
        success: true,
        message: 'No guidelines need content repair',
        processed: 0,
        succeeded: 0,
        failed: 0,
        remaining: 0
      });
    }

    // Process only the first batch
    const batch = guidelinesNeedingRepair.slice(0, batchSize);
    const results = [];

    console.log(`[CONTENT_REPAIR] Processing ${batch.length} guidelines...`);

    for (const guideline of batch) {
      console.log(`[CONTENT_REPAIR] Processing: ${guideline.id}`);
      
      try {
        const data = guideline.data;
        let content = data.content;
        let condensed = data.condensed;
        let summary = data.summary;
        let updated = false;
        const updates = {};

        // Determine the PDF filename
        let pdfFileName = null;
        if (data.filename && data.filename.toLowerCase().endsWith('.pdf')) {
          pdfFileName = data.filename;
        } else if (data.originalFilename && data.originalFilename.toLowerCase().endsWith('.pdf')) {
          pdfFileName = data.originalFilename;
        } else if (data.title && data.title.toLowerCase().endsWith('.pdf')) {
          pdfFileName = data.title;
        } else if (data.filename) {
          pdfFileName = data.filename.replace(/\.[^.]+$/, '.pdf');
        }

        if (!pdfFileName) {
          throw new Error('Cannot determine PDF filename for content extraction');
        }

        console.log(`[CONTENT_REPAIR] PDF filename: ${pdfFileName}`);

        // Extract text from PDF if content is missing
        if (!content || content.trim().length === 0 || forceRegenerate) {
          console.log(`[CONTENT_REPAIR] Extracting text from PDF...`);
          const fullText = await fetchAndExtractPDFText(pdfFileName);
          
          if (!fullText || fullText.trim().length < 100) {
            throw new Error('Failed to extract meaningful text from PDF');
          }

          console.log(`[CONTENT_REPAIR] Successfully extracted ${fullText.length} characters`);

          // Generate condensed version
          console.log(`[CONTENT_REPAIR] Generating condensed text...`);
          const condensedText = await generateCondensedText(fullText, null);
          
          if (condensedText) {
            content = fullText; // Store FULL text in content field
            condensed = condensedText; // Store condensed text in condensed field
            updates.content = fullText; // Store FULL text in content field
            updates.condensed = condensedText;
            console.log(`[CONTENT_REPAIR] ✓ Generated condensed text: ${condensedText.length} characters (full text: ${fullText.length} characters)`);
          } else {
            content = fullText;
            condensed = fullText;
            updates.content = fullText;
            updates.condensed = fullText;
            console.warn(`[CONTENT_REPAIR] Using full text as condensed version failed`);
          }

          updated = true;

          // Generate summary if needed
          if (!summary || summary.trim().length === 0) {
            console.log(`[CONTENT_REPAIR] Generating summary...`);
            try {
              const summaryPrompt = `Please provide a concise summary of this clinical guideline in 2-3 paragraphs:\n\n${content.substring(0, 4000)}`;
              const summaryMessages = [
                { role: 'system', content: 'You are a medical expert creating concise summaries of clinical guidelines.' },
                { role: 'user', content: summaryPrompt }
              ];
              
              const summaryResult = await sendToAI(summaryMessages, 'deepseek-chat', null, null);
              
              if (summaryResult && summaryResult.content) {
                summary = summaryResult.content.trim();
                updates.summary = summary;
                console.log(`[CONTENT_REPAIR] ✓ Generated summary: ${summary.length} characters`);
              }
            } catch (summaryError) {
              console.error(`[CONTENT_REPAIR] Error generating summary:`, summaryError.message);
            }
          }

          // Extract keywords if needed
          if (!data.keywords || data.keywords.length === 0) {
            updates.keywords = extractKeywords(summary || content);
            console.log(`[CONTENT_REPAIR] ✓ Extracted keywords: ${updates.keywords.length} keywords`);
          }
        } else if (!condensed || condensed.trim().length === 0) {
          // Content exists but condensed is missing
          console.log(`[CONTENT_REPAIR] Condensed missing, using existing content`);
          updates.condensed = content;
          updated = true;
        }

        // Update Firestore if any changes were made
        if (updated && Object.keys(updates).length > 0) {
          // Prepare content for Firestore (handles large content by uploading to Storage)
          console.log(`[CONTENT_REPAIR] Preparing content for Firestore storage...`);
          
          // Get the final content values (either from updates or existing)
          const finalContent = updates.content || content;
          const finalCondensed = updates.condensed || condensed;
          const finalSummary = updates.summary || summary;
          
          const preparedContent = await prepareContentForFirestore(
            finalContent,
            finalCondensed,
            finalSummary,
            guideline.id
          );
          
          // Update the updates object with prepared content
          // Use FieldValue.delete() to remove fields from Firestore when stored in Storage
          if (preparedContent.contentStorageUrl) {
            updates.content = admin.firestore.FieldValue.delete();  // Remove from Firestore
            updates.contentStorageUrl = preparedContent.contentStorageUrl;
          } else if (preparedContent.content !== undefined) {
            updates.content = preparedContent.content;
          }
          
          if (preparedContent.condensedStorageUrl) {
            updates.condensed = admin.firestore.FieldValue.delete();  // Remove from Firestore
            updates.condensedStorageUrl = preparedContent.condensedStorageUrl;
          } else if (preparedContent.condensed !== undefined) {
            updates.condensed = preparedContent.condensed;
          }
          
          if (preparedContent.summaryStorageUrl) {
            updates.summary = admin.firestore.FieldValue.delete();  // Remove from Firestore
            updates.summaryStorageUrl = preparedContent.summaryStorageUrl;
          } else if (preparedContent.summary !== undefined) {
            updates.summary = preparedContent.summary;
          }
          
          if (preparedContent.contentInStorage) {
            updates.contentInStorage = true;
          }
          
          updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await db.collection('guidelines').doc(guideline.id).update(updates);
          console.log(`[CONTENT_REPAIR] ✓ Updated guideline: ${guideline.id}`);
          
          results.push({
            guideline: guideline.id,
            success: true,
            message: 'Successfully repaired content',
            fieldsUpdated: Object.keys(updates),
            usedStorage: preparedContent.contentInStorage
          });
        } else {
          results.push({
            guideline: guideline.id,
            success: true,
            message: 'No updates needed'
          });
        }

      } catch (error) {
        console.error(`[CONTENT_REPAIR] Error processing ${guideline.id}:`, error.message);
        console.error(`[CONTENT_REPAIR] Error stack:`, error.stack);
        results.push({
          guideline: guideline.id,
          success: false,
          error: error.message || 'Unknown error',
          errorDetails: error.toString()
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    console.log(`[CONTENT_REPAIR] Batch complete: ${successCount} succeeded, ${failureCount} failed`);

    res.json({
      success: true,
      message: `Processed ${batch.length} guidelines`,
      processed: batch.length,
      succeeded: successCount,
      failed: failureCount,
      remaining: guidelinesNeedingRepair.length - batch.length,
      total: guidelinesNeedingRepair.length,
      results: results
    });

  } catch (error) {
    console.error('[CONTENT_REPAIR] Critical error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Error in content repair endpoint'
    });
  }
});

// Endpoint to re-extract raw PDF content and update Firestore
// This uses pdf-parse (same as our extractTextFromPDF function) to get verbatim text
app.post('/reextractGuidelineContent', authenticateUser, async (req, res) => {
    try {
        const { guidelineId, processAll } = req.body;
        
        console.log('[REEXTRACT] Starting content re-extraction', { guidelineId, processAll });
        
        // Check if user is admin (optional - for now allow any authenticated user)
        const userId = req.user?.uid;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User not authenticated' });
        }
        
        const results = [];
        let guidelinesToProcess = [];
        
        if (processAll) {
            // Get all guidelines from Firestore
            const snapshot = await db.collection('guidelines').get();
            snapshot.forEach(doc => {
                guidelinesToProcess.push({ id: doc.id, ...doc.data() });
            });
            console.log(`[REEXTRACT] Processing all ${guidelinesToProcess.length} guidelines`);
        } else if (guidelineId) {
            // Process single guideline
            const doc = await db.collection('guidelines').doc(guidelineId).get();
            if (!doc.exists) {
                return res.status(404).json({ success: false, error: `Guideline not found: ${guidelineId}` });
            }
            guidelinesToProcess.push({ id: doc.id, ...doc.data() });
            console.log(`[REEXTRACT] Processing single guideline: ${guidelineId}`);
        } else {
            return res.status(400).json({ success: false, error: 'Must provide guidelineId or processAll=true' });
        }
        
        for (const guideline of guidelinesToProcess) {
            try {
                console.log(`[REEXTRACT] Processing: ${guideline.id}`);
                console.log(`[REEXTRACT] Available fields:`, Object.keys(guideline).join(', '));
                
                // Try multiple filename fields in order of preference
                const possibleFilenames = [
                    guideline.filename,
                    guideline.originalFilename,
                    guideline.pdfFilename,
                    guideline.title ? guideline.title + '.pdf' : null,
                    guideline.humanFriendlyName ? guideline.humanFriendlyName + '.pdf' : null
                ].filter(Boolean);
                
                console.log(`[REEXTRACT] Possible filenames:`, possibleFilenames);
                console.log(`[REEXTRACT] downloadUrl:`, guideline.downloadUrl || 'not set');
                
                // Helper function to normalize filename for comparison
                const normalizeForMatch = (str) => {
                    return str
                        .toLowerCase()
                        .replace(/\.pdf$/i, '')
                        .replace(/[''""]/g, "'")
                        .replace(/[–—]/g, '-')
                        .replace(/[\s\-_]+/g, '')  // Remove all spaces, hyphens, underscores
                        .replace(/[^\w]/g, '');     // Remove all non-alphanumeric
                };
                
                // Helper function to calculate similarity (simple containment check)
                const calculateSimilarity = (target, candidate) => {
                    const t = normalizeForMatch(target);
                    const c = normalizeForMatch(candidate);
                    if (t === c) return 1.0;
                    if (t.includes(c) || c.includes(t)) return 0.9;
                    
                    // Check how many consecutive characters match
                    let maxMatch = 0;
                    for (let i = 0; i < t.length; i++) {
                        for (let j = 0; j < c.length; j++) {
                            let k = 0;
                            while (i + k < t.length && j + k < c.length && t[i + k] === c[j + k]) {
                                k++;
                            }
                            maxMatch = Math.max(maxMatch, k);
                        }
                    }
                    return maxMatch / Math.max(t.length, c.length);
                };
                
                let pdfBuffer = null;
                let usedFilename = null;
                
                // STRATEGY 1: Try downloadUrl field first (most reliable)
                if (guideline.downloadUrl) {
                    try {
                        console.log(`[REEXTRACT] Trying downloadUrl: ${guideline.downloadUrl}`);
                        const response = await axios.get(guideline.downloadUrl, { 
                            responseType: 'arraybuffer',
                            timeout: 30000,
                            headers: {
                                'User-Agent': 'Clerky/1.0'
                            }
                        });
                        pdfBuffer = Buffer.from(response.data);
                        usedFilename = guideline.downloadUrl.split('/').pop() || 'downloaded.pdf';
                        console.log(`[REEXTRACT] ✅ Downloaded from downloadUrl: ${usedFilename} (${pdfBuffer.length} bytes)`);
                    } catch (downloadError) {
                        console.log(`[REEXTRACT] ❌ downloadUrl failed: ${downloadError.message}`);
                    }
                }
                
                // STRATEGY 2: Try Firebase Storage (where PDFs may be stored)
                if (!pdfBuffer) {
                    const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
                    
                    // First, try exact matches
                    for (const filename of possibleFilenames) {
                    // Ensure .pdf extension
                    const pdfFileName = filename.toLowerCase().endsWith('.pdf') ? filename : filename + '.pdf';
                    
                    try {
                        console.log(`[REEXTRACT] Trying Firebase Storage: pdfs/${pdfFileName}`);
                        const file = bucket.file(`pdfs/${pdfFileName}`);
                        const [exists] = await file.exists();
                        
                        if (exists) {
                            const [buffer] = await file.download();
                            pdfBuffer = buffer;
                            usedFilename = pdfFileName;
                            console.log(`[REEXTRACT] ✅ Found in Firebase Storage: ${pdfFileName} (${buffer.length} bytes)`);
                            break;
                        }
                    } catch (e) {
                        console.log(`[REEXTRACT] Not found: pdfs/${pdfFileName}`);
                    }
                }
                
                // If not found with exact match, try fuzzy matching in Firebase Storage
                if (!pdfBuffer) {
                    console.log(`[REEXTRACT] Exact match not found, trying fuzzy match in Firebase Storage...`);
                    try {
                        // List all files in the pdfs folder
                        const [files] = await bucket.getFiles({ prefix: 'pdfs/' });
                        const pdfFiles = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
                        console.log(`[REEXTRACT] Found ${pdfFiles.length} PDF files in Firebase Storage`);
                        
                        let bestMatch = null;
                        let bestScore = 0;
                        
                        for (const targetFilename of possibleFilenames) {
                            const targetName = (targetFilename.toLowerCase().endsWith('.pdf') ? targetFilename : targetFilename + '.pdf');
                            
                            for (const file of pdfFiles) {
                                // file.name includes 'pdfs/' prefix, so extract just the filename
                                const storedFilename = file.name.replace(/^pdfs\//, '');
                                const score = calculateSimilarity(targetName, storedFilename);
                                
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestMatch = file;
                                }
                            }
                        }
                        
                        if (bestMatch && bestScore >= 0.7) {
                            const matchedName = bestMatch.name.replace(/^pdfs\//, '');
                            console.log(`[REEXTRACT] ✅ Fuzzy match in Firebase Storage: ${matchedName} (score: ${bestScore.toFixed(2)})`);
                            const [buffer] = await bestMatch.download();
                            pdfBuffer = buffer;
                            usedFilename = matchedName;
                        } else if (bestMatch) {
                            console.log(`[REEXTRACT] Best Storage match was ${bestMatch.name} but score too low: ${bestScore.toFixed(2)}`);
                        }
                    } catch (listError) {
                        console.log(`[REEXTRACT] Error listing Firebase Storage files: ${listError.message}`);
                    }
                }
                } // End of Firebase Storage strategy
                
                // STRATEGY 3: Try GitHub API as fallback
                if (!pdfBuffer) {
                    console.log(`[REEXTRACT] Not found via downloadUrl or Firebase Storage, trying GitHub API...`);
                    
                    // First, list all files in the guidance folder to find a match
                    try {
                        const listResponse = await axios.get(
                            `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/guidance`,
                            {
                                headers: {
                                    'Authorization': `token ${GITHUB_TOKEN}`,
                                    'Accept': 'application/vnd.github.v3+json'
                                }
                            }
                        );
                        
                        const files = listResponse.data.filter(f => f.name.toLowerCase().endsWith('.pdf'));
                        console.log(`[REEXTRACT] Found ${files.length} PDF files in GitHub guidance folder`);
                        
                        // Try to find a matching file using multiple strategies
                        let matchedFile = null;
                        let bestScore = 0;
                        
                        for (const targetFilename of possibleFilenames) {
                            const targetName = (targetFilename.toLowerCase().endsWith('.pdf') ? targetFilename : targetFilename + '.pdf');
                            const normalizedTarget = normalizeForMatch(targetName);
                            
                            // Strategy 1: Exact match
                            matchedFile = files.find(f => f.name.toLowerCase() === targetName.toLowerCase());
                            if (matchedFile) {
                                console.log(`[REEXTRACT] ✅ Exact match found: ${matchedFile.name}`);
                                break;
                            }
                            
                            // Strategy 2: Normalized exact match
                            matchedFile = files.find(f => normalizeForMatch(f.name) === normalizedTarget);
                            if (matchedFile) {
                                console.log(`[REEXTRACT] ✅ Normalized match found: ${matchedFile.name}`);
                                break;
                            }
                            
                            // Strategy 3: Find best fuzzy match
                            for (const file of files) {
                                const score = calculateSimilarity(targetName, file.name);
                                if (score > bestScore) {
                                    bestScore = score;
                                    matchedFile = file;
                                }
                            }
                        }
                        
                        // Accept fuzzy match if score is good enough (>0.7)
                        if (matchedFile && bestScore >= 0.7) {
                            console.log(`[REEXTRACT] Found matching file in GitHub: ${matchedFile.name} (score: ${bestScore.toFixed(2)})`);
                            const fileResponse = await axios.get(matchedFile.download_url, { responseType: 'arraybuffer' });
                            pdfBuffer = Buffer.from(fileResponse.data);
                            usedFilename = matchedFile.name;
                            console.log(`[REEXTRACT] ✅ Downloaded from GitHub: ${matchedFile.name} (${pdfBuffer.length} bytes)`);
                        } else if (matchedFile) {
                            console.log(`[REEXTRACT] Best match was ${matchedFile.name} but score too low: ${bestScore.toFixed(2)}`);
                        } else {
                            console.log(`[REEXTRACT] No matching file found in GitHub for: ${possibleFilenames.join(', ')}`);
                        }
                    } catch (listError) {
                        console.log(`[REEXTRACT] Error listing GitHub files: ${listError.message}`);
                    }
                }
                
                if (!pdfBuffer) {
                    results.push({
                        id: guideline.id,
                        success: false,
                        error: `Could not fetch PDF. Tried: ${possibleFilenames.join(', ')}`
                    });
                    continue;
                }
                
                // Extract text using pdf-parse (same library as extractTextFromPDF)
                const pdfData = await PDFParser(pdfBuffer);
                let extractedText = pdfData.text;
                
                if (!extractedText || extractedText.trim().length < 100) {
                    results.push({
                        id: guideline.id,
                        success: false,
                        error: 'Extracted text too short or empty'
                    });
                    continue;
                }
                
                // Basic cleanup only - preserve verbatim text
                const cleanedText = extractedText
                    .replace(/\f/g, '\n')  // Form feeds to newlines
                    .replace(/\x0c/g, '\n')  // Form feeds to newlines
                    .replace(/\n\s*\n\s*\n/g, '\n\n')  // Multiple newlines to double
                    .replace(/ +/g, ' ')  // Multiple spaces to single
                    .replace(/\t+/g, ' ')  // Tabs to spaces
                    .trim();
                
                // Check for spelling sample to verify extraction
                const spellingCheck = cleanedText.match(/magnesium.{0,5}(sulf|sulph)/i);
                console.log(`[REEXTRACT] ${guideline.id} - Spelling check: ${spellingCheck ? spellingCheck[0] : 'not found'}`);
                
                // Update Firestore with the new content
                const oldContentLength = guideline.content ? guideline.content.length : 0;
                
                await db.collection('guidelines').doc(guideline.id).update({
                    content: cleanedText,
                    contentReextractedAt: admin.firestore.FieldValue.serverTimestamp(),
                    contentLength: cleanedText.length
                });
                
                results.push({
                    id: guideline.id,
                    success: true,
                    oldLength: oldContentLength,
                    newLength: cleanedText.length,
                    spellingCheck: spellingCheck ? spellingCheck[0] : null
                });
                
                console.log(`[REEXTRACT] ✅ Updated ${guideline.id}: ${oldContentLength} -> ${cleanedText.length} chars`);
                
            } catch (guidelineError) {
                console.error(`[REEXTRACT] Error processing ${guideline.id}:`, guidelineError.message);
                results.push({
                    id: guideline.id,
                    success: false,
                    error: guidelineError.message
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        const failureCount = results.filter(r => !r.success).length;
        
        console.log(`[REEXTRACT] Completed: ${successCount} success, ${failureCount} failed`);
        
        res.json({
            success: true,
            processed: results.length,
            successCount,
            failureCount,
            results
        });
        
    } catch (error) {
        console.error('[REEXTRACT] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Endpoint to get guidelines list from GitHub
app.get('/getGuidelinesList', authenticateUser, async (req, res) => {
    try {
        // debugLog('[DEBUG] getGuidelinesList endpoint called');
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

// Endpoint: discover guidelines using HYBRID approach (scraping + AI)
app.post('/discoverGuidelines', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        console.log('[DISCOVERY] Starting hybrid guideline discovery...');
        
        // Load existing guidelines from cache
        let allGuidelines = [];
        try {
            allGuidelines = await getCachedGuidelines();
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
        let includedSourceUrls = [];
        if (db) {
            try {
                const colRef = db.collection('users').doc(userId).collection('guidelinePrefs').doc('items').collection('entries');
                const snapshot = await colRef.get();
                snapshot.forEach(doc => {
                    const d = doc.data() || {};
                    if (d.type === 'excluded' && d.normalisedUrl) excludedSourceUrls.push(d.normalisedUrl);
                    if (d.type === 'excluded' && d.canonicalId) excludedCanonicalIds.push(String(d.canonicalId).toLowerCase());
                    if (d.type === 'included' && d.normalisedUrl) includedSourceUrls.push(d.normalisedUrl);
                });
            } catch (_) {}
        }
        const excludedUrlSet = new Set(excludedSourceUrls.map(u => normalizeUrl(u)));
        const includedUrlSet = new Set(includedSourceUrls.map(u => normalizeUrl(u)));

        // STEP 1: Run web scraping for RCOG and NICE (guaranteed accurate)
        console.log('[DISCOVERY] Step 1: Web scraping RCOG and NICE...');
        let scrapedGuidelines = [];
        try {
            const [rcogResults, niceResults] = await Promise.all([
                scrapeRCOGGuidelines(),
                scrapeNICEGuidelines()
            ]);
            scrapedGuidelines = [...rcogResults, ...niceResults];
            console.log(`[DISCOVERY] Scraped ${scrapedGuidelines.length} guidelines (RCOG: ${rcogResults.length}, NICE: ${niceResults.length})`);
        } catch (scrapeError) {
            console.error('[DISCOVERY] Scraping failed:', scrapeError.message);
            // Continue with AI even if scraping fails
        }

        const systemPrompt = `You are assisting an Obstetrics & Gynaecology clinician. Identify official guidance documents that would be useful for day-to-day clinical work in the UK.

Organizations to search:

1. RCOG (Royal College of Obstetricians and Gynaecologists) - rcog.org.uk
   - Green-top Guidelines
   - Scientific Impact Papers (SIPs)
   - Consent Advice documents
   - Good Practice Papers

2. NICE (National Institute for Health and Care Excellence) - nice.org.uk
   - Guidelines relevant to O&G: antenatal care, pregnancy, labour, postnatal, fertility, menopause, gynaecological conditions
   - Example codes: NG201, NG194, NG235, NG121, CG192, CG190, NG4, NG25, NG126, CG149, NG133, NG137, CG156, NG23

3. FSRH (Faculty of Sexual & Reproductive Healthcare) - fsrh.org
   - Clinical guidance on contraception, sexual health, reproductive healthcare

4. BASHH (British Association for Sexual Health and HIV) - bashh.org
   - Clinical guidelines on sexual health, STIs relevant to O&G practice

5. BMS (British Menopause Society) - thebms.org.uk
   - Guidance on menopause management and HRT

6. BSH (British Society for Haematology) - b-s-h.org.uk
   - Haematology guidance relevant to O&G (e.g., anaemia in pregnancy, thrombosis)

7. BHIVA (British HIV Association) - bhiva.org
   - HIV guidance relevant to pregnancy and women's health

8. BAPM (British Association of Perinatal Medicine) - bapm.org
   - Perinatal and neonatal guidance relevant to obstetrics

9. UK NSC (UK National Screening Committee) - gov.uk/government/organisations/uk-national-screening-committee
   - Screening programmes relevant to pregnancy and women's health

10. NHS England - england.nhs.uk
    - National maternity guidance, commissioning standards, women's health policy

11. Subspecialty Societies:
    - BSGE (British Society for Gynaecological Endoscopy) - bsge.org.uk
    - BSUG (British Society of Urogynaecology) - bsug.org
    - BGCS (British Gynaecological Cancer Society) - bgcs.org.uk
    - BSCCP (British Society for Colposcopy and Cervical Pathology) - bsccp.org.uk
    - BFS (British Fertility Society) - britishfertilitysociety.org.uk
    - BMFMS (British Maternal & Fetal Medicine Society) - bmfms.org.uk
    - BritSPAG (British Society for Paediatric and Adolescent Gynaecology) - britspag.org

Rules:
- Return only items that have an official, publicly accessible download URL (preferably PDF) from authoritative domains listed above.
- Avoid duplicates, and avoid items already provided in the existing list.
- For each guideline, determine the correct organization abbreviation from the list above.
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

        const userPrompt = `Existing guidelines:\n${existingSummary}\n\nExcluded source URLs (normalised):\n${Array.from(excludedUrlSet).join('\n')}\n\nTask: Propose additional, currently available guidance items from ALL organizations listed in the system prompt (RCOG, NICE, FSRH, BASHH, BMS, BSH, BHIVA, BAPM, UK NSC, NHS England, and subspecialty societies) that would be useful to a working O&G doctor but are not yet included or excluded. 

For each item, return an object with keys: 
- title (string): Full title of the guidance
- organisation (string): Use exact abbreviation from system prompt (e.g., "RCOG", "NICE", "FSRH", "BASHH", "BMS", "BSH", "BHIVA", "BAPM", "UK NSC", "NHS England", "BSGE", "BSUG", "BGCS", "BSCCP", "BFS", "BMFMS", "BritSPAG")
- type (string): Type of document (e.g., "Green-top Guideline", "SIP", "Consent Advice", "Good Practice Paper", "Clinical Guideline", "Clinical Guidance", "Best Practice")
- year (number or null): Publication or revision year
- url (string): Direct downloadable URL (preferably PDF)
- notes (optional string): Any relevant context

Return a single JSON array only, with at least 5-10 suggestions from various organizations.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        // STEP 2: Run AI for other organizations (FSRH, BASHH, etc.)
        console.log('[DISCOVERY] Step 2: AI search for other organizations...');
        let aiSuggestions = [];
        try {
            const aiResult = await routeToAI({ messages }, userId);
            if (aiResult && aiResult.content) {
                let text = aiResult.content.trim();
                text = text.replace(/^```json\s*|```$/g, '').trim();
                
                const start = text.indexOf('[');
                const end = text.lastIndexOf(']');
                const jsonStr = (start !== -1 && end !== -1) ? text.substring(start, end + 1) : text;
                aiSuggestions = JSON.parse(jsonStr);
                
                if (!Array.isArray(aiSuggestions)) {
                    console.error('[DISCOVERY] AI did not return array');
                    aiSuggestions = [];
                }
                console.log(`[DISCOVERY] AI suggested ${aiSuggestions.length} guidelines`);
            }
        } catch (aiError) {
            console.error('[DISCOVERY] AI search failed:', aiError.message);
            // Continue with just scraped results
        }

        // STEP 3: Combine and validate all results
        console.log('[DISCOVERY] Step 3: Combining and validating results...');
        const allDiscovered = [...scrapedGuidelines, ...aiSuggestions];
        const seen = new Set([...excludedUrlSet, ...existingUrls, ...includedUrlSet]);
        const filtered = [];
        
        // Helper: check if title is similar enough to an existing guideline
        function isSimilarTitle(newTitle, existingGuidelines) {
            const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
            const newNorm = normalize(newTitle);
            
            for (const existing of existingGuidelines) {
                const existingNorm = normalize(existing.title || '');
                
                // Exact match after normalisation
                if (newNorm === existingNorm) return true;
                
                // Extract guideline numbers for comparison
                const newNum = newTitle.match(/No\.\s*(\d+[a-z]?)/i);
                const existingNum = (existing.title || '').match(/No\.\s*(\d+[a-z]?)/i);
                
                // If both have numbers and they match, consider it a duplicate
                if (newNum && existingNum && newNum[1].toLowerCase() === existingNum[1].toLowerCase()) {
                    // Also check organisation matches
                    if (!existing.organisation || !newTitle || 
                        newTitle.toLowerCase().includes(existing.organisation.toLowerCase()) ||
                        (existing.organisation === 'RCOG' && newTitle.toLowerCase().includes('green'))) {
                        return true;
                    }
                }
                
                // Check if one title contains most of the other (for partial matches)
                if (newNorm.length > 20 && existingNorm.length > 20) {
                    const shorter = newNorm.length < existingNorm.length ? newNorm : existingNorm;
                    const longer = newNorm.length < existingNorm.length ? existingNorm : newNorm;
                    // If 80% of shorter string is in longer string, likely duplicate
                    const words = shorter.split(' ').filter(w => w.length > 3);
                    const matchCount = words.filter(w => longer.includes(w)).length;
                    if (words.length > 0 && matchCount / words.length > 0.8) {
                        return true;
                    }
                }
            }
            return false;
        }
        
        let invalidUrlCount = 0;
        let duplicateCount = 0;
        for (const item of allDiscovered) {
            if (!item || !item.url || !item.title) continue;
            
            const norm = normalizeUrl(item.url);
            
            // Skip if URL already exists, excluded, or already included
            if (seen.has(norm)) {
                duplicateCount++;
                continue;
            }
            
            // Check canonicalId if present
            if (item.canonicalId) {
                const itemCanonicalId = String(item.canonicalId).toLowerCase();
                if (existingCanonicalIds.has(itemCanonicalId)) {
                    console.log(`[DISCOVERY] Skipping duplicate by canonicalId: ${item.canonicalId} - ${item.title}`);
                    duplicateCount++;
                    continue;
                }
                if (excludedCanonicalIds.includes(itemCanonicalId)) {
                    console.log(`[DISCOVERY] Skipping excluded by canonicalId: ${item.canonicalId} - ${item.title}`);
                    duplicateCount++;
                    continue;
                }
            }
            
            // Check for similar titles
            if (isSimilarTitle(item.title, allGuidelines)) {
                console.log(`[DISCOVERY] Skipping likely duplicate by title: ${item.title}`);
                duplicateCount++;
                continue;
            }
            
            // CRITICAL: Validate URL matches expected domain for organization
            if (item.organisation && !validateGuidelineUrl(item.url, item.organisation)) {
                invalidUrlCount++;
                console.warn(`[DISCOVERY] Invalid URL for ${item.organisation}: ${item.url}`);
                continue;
            }
            
            seen.add(norm);
            filtered.push({
                title: item.title,
                organisation: item.organisation || null,
                type: item.type || null,
                year: item.year || null,
                url: item.url,
                notes: item.notes || null,
                canonicalId: item.canonicalId || null
            });
        }

        console.log(`[DISCOVERY] Final results: ${filtered.length} valid suggestions (${duplicateCount} duplicates filtered, ${invalidUrlCount} invalid URLs filtered)`);

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
    debugLog('[DEBUG] updateGuidelinesWithAuditableElements endpoint called');
    
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

// ============================================================================
// CLINICAL GUIDANCE POINT (CGP) VALIDATION ENDPOINTS
// ISO 13485-compliant multi-stage validation workflow
// ============================================================================

// Import CGP validation module
const {
    extractClinicalGuidancePoints,
    crossValidateClinicalGuidancePoints,
    arbitrateCGPDisagreements,
    getNextLLMProvider
} = require('./modules/cgp-validation.js');

/**
 * Step 1: Extract Clinical Guidance Points with clinical context
 */
app.post('/extractClinicalGuidancePoints', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineId, aiProvider = 'DeepSeek' } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId is required'
            });
        }
        
        // Get guideline from Firestore
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guideline = guidelineDoc.data();
        const content = guideline.content || guideline.condensed;
        
        if (!content) {
            return res.status(400).json({
                success: false,
                error: 'No content available for extraction'
            });
        }
        
        // Check current approval state
        const currentState = guideline.cgpApprovalState || { status: 'not_started' };
        if (currentState.status === 'approved') {
            return res.status(400).json({
                success: false,
                error: 'Guideline is already approved. Cannot re-extract CGPs.',
                currentState: currentState.status
            });
        }
        
        // Create wrapper for logAIInteraction to match expected signature
        const logAIWrapper = async (interactionData, metadata) => {
            // Extract prompt and response from interactionData
            const prompt = interactionData.prompt || '';
            const response = { 
                ...metadata,
                ai_provider: interactionData.aiProvider,
                ai_model: interactionData.aiModel,
                token_usage: interactionData.tokenUsage,
                content: JSON.stringify(metadata, null, 2)
            };
            const endpoint = interactionData.endpoint || 'extractClinicalGuidancePoints';
            return await logAIInteraction(prompt, response, endpoint);
        };
        
        // Run Step 1 extraction
        const result = await extractClinicalGuidancePoints(
            content,
            aiProvider,
            userId,
            routeToAI,
            logAIWrapper
        );
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to extract CGPs'
            });
        }
        
        // CGPs already have Date objects for timestamps - Firestore will convert them automatically
        // No need to convert here since serverTimestamp() cannot be used inside arrays
        const enrichedCGPs = result.cgps;
        
        // Update guideline with extracted CGPs and approval state
        await guidelineRef.update({
            clinicalGuidancePoints: enrichedCGPs,
            cgpApprovalState: {
                status: 'llm_extraction',
                currentStep: 'extraction',
                startedAt: currentState.startedAt || admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                reviewedBy: null,
                approvalDate: null
            },
            cgpValidationLog: {
                extraction: {
                    llmProvider: result.metadata.llmProvider,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    elementsExtracted: result.cgps.length
                }
            },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            cgps: enrichedCGPs,
            metadata: result.metadata,
            guidelineId: guidelineId
        });
        
    } catch (error) {
        console.error('[CGP] Error in extractClinicalGuidancePoints endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Step 2: Cross-validate CGPs using a different LLM provider
 */
app.post('/crossValidateCGPs', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineId, aiProvider } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId is required'
            });
        }
        
        // Get guideline from Firestore
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guideline = guidelineDoc.data();
        const content = guideline.content || guideline.condensed;
        const extractedCGPs = guideline.clinicalGuidancePoints || [];
        
        if (extractedCGPs.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No CGPs found. Please run extraction first.'
            });
        }
        
        if (!content) {
            return res.status(400).json({
                success: false,
                error: 'No content available for validation'
            });
        }
        
        // Determine validation provider (different from extraction)
        const extractionProvider = guideline.cgpValidationLog?.extraction?.llmProvider || 'DeepSeek';
        const validationProvider = aiProvider || getNextLLMProvider([extractionProvider]);
        
        // Create wrapper for logAIInteraction
        const logAIWrapper = async (interactionData, metadata) => {
            const prompt = interactionData.prompt || '';
            const response = { 
                ...metadata,
                ai_provider: interactionData.aiProvider,
                ai_model: interactionData.aiModel,
                token_usage: interactionData.tokenUsage,
                content: JSON.stringify(metadata, null, 2)
            };
            const endpoint = interactionData.endpoint || 'crossValidateCGPs';
            return await logAIInteraction(prompt, response, endpoint);
        };
        
        // Run Step 2 cross-validation
        const result = await crossValidateClinicalGuidancePoints(
            content,
            extractedCGPs,
            validationProvider,
            userId,
            routeToAI,
            logAIWrapper
        );
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to cross-validate CGPs'
            });
        }
        
        // CGPs already have Date objects for timestamps - Firestore will convert them automatically
        // No need to convert here since serverTimestamp() cannot be used inside arrays
        const validatedCGPs = result.cgps;
        
        // Update guideline with validated CGPs
        await guidelineRef.update({
            clinicalGuidancePoints: validatedCGPs,
            cgpApprovalState: {
                status: 'cross_validation',
                currentStep: 'validation',
                startedAt: guideline.cgpApprovalState?.startedAt || admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                reviewedBy: null,
                approvalDate: null
            },
            'cgpValidationLog.crossValidation': {
                llmProvider: result.metadata.llmProvider,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                totalElements: result.metadata.totalElements,
                validated: result.metadata.validated,
                disagreements: result.metadata.disagreements
            },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            cgps: validatedCGPs,
            metadata: result.metadata,
            summary: result.summary,
            guidelineId: guidelineId
        });
        
    } catch (error) {
        console.error('[CGP] Error in crossValidateCGPs endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Step 3: Arbitrate disagreements between Step 1 and Step 2
 */
app.post('/arbitrateCGPDisagreements', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineId, aiProvider } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId is required'
            });
        }
        
        // Get guideline from Firestore
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guideline = guidelineDoc.data();
        const content = guideline.content || guideline.condensed;
        const validatedCGPs = guideline.clinicalGuidancePoints || [];
        
        if (validatedCGPs.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No CGPs found. Please run extraction and validation first.'
            });
        }
        
        if (!content) {
            return res.status(400).json({
                success: false,
                error: 'No content available for arbitration'
            });
        }
        
        // Check if there are disagreements
        const disagreementCount = validatedCGPs.filter(cgp => 
            cgp.validationStatus === 'disagreement'
        ).length;
        
        if (disagreementCount === 0) {
            // No disagreements, skip arbitration
            await guidelineRef.update({
                cgpApprovalState: {
                    status: 'arbitration',
                    currentStep: 'arbitration',
                    startedAt: guideline.cgpApprovalState?.startedAt || admin.firestore.FieldValue.serverTimestamp(),
                    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                    reviewedBy: null,
                    approvalDate: null
                },
                'cgpValidationLog.arbitration': {
                    llmProvider: 'none',
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    disagreementsResolved: 0
                },
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
            
            return res.json({
                success: true,
                cgps: validatedCGPs,
                metadata: {
                    llmProvider: 'none',
                    disagreementsResolved: 0,
                    skipped: true,
                    reason: 'No disagreements found'
                },
                guidelineId: guidelineId
            });
        }
        
        // Determine arbitration provider (different from both previous steps)
        const extractionProvider = guideline.cgpValidationLog?.extraction?.llmProvider || 'DeepSeek';
        const validationProvider = guideline.cgpValidationLog?.crossValidation?.llmProvider || 'Anthropic';
        const arbitrationProvider = aiProvider || getNextLLMProvider([extractionProvider, validationProvider]);
        
        // Get original extraction CGPs for comparison (stored in validation log or reconstruct)
        // For now, we'll use validated CGPs and filter by extractedBy field
        const llm1CGPs = validatedCGPs.filter(cgp => cgp.extractedBy === 'llm1');
        const llm2CGPs = validatedCGPs;
        
        // Create wrapper for logAIInteraction
        const logAIWrapper = async (interactionData, metadata) => {
            const prompt = interactionData.prompt || '';
            const response = { 
                ...metadata,
                ai_provider: interactionData.aiProvider,
                ai_model: interactionData.aiModel,
                token_usage: interactionData.tokenUsage,
                content: JSON.stringify(metadata, null, 2)
            };
            const endpoint = interactionData.endpoint || 'arbitrateCGPDisagreements';
            return await logAIInteraction(prompt, response, endpoint);
        };
        
        // Run Step 3 arbitration
        const result = await arbitrateCGPDisagreements(
            content,
            llm1CGPs,
            llm2CGPs,
            arbitrationProvider,
            userId,
            routeToAI,
            logAIWrapper
        );
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: result.error || 'Failed to arbitrate disagreements'
            });
        }
        
        // Update guideline with arbitrated CGPs
        await guidelineRef.update({
            clinicalGuidancePoints: result.cgps,
            cgpApprovalState: {
                status: 'arbitration',
                currentStep: 'arbitration',
                startedAt: guideline.cgpApprovalState?.startedAt || admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                reviewedBy: null,
                approvalDate: null
            },
            'cgpValidationLog.arbitration': {
                llmProvider: result.metadata.llmProvider,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                disagreementsResolved: result.metadata.disagreementsResolved
            },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        res.json({
            success: true,
            cgps: result.cgps,
            metadata: result.metadata,
            guidelineId: guidelineId
        });
        
    } catch (error) {
        console.error('[CGP] Error in arbitrateCGPDisagreements endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Save clinician review decisions for CGPs
 */
app.post('/saveCGPClinicianReview', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineId, reviews } = req.body;
        
        if (!guidelineId || !reviews || !Array.isArray(reviews)) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId and reviews array are required'
            });
        }
        
        // Get guideline from Firestore
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guideline = guidelineDoc.data();
        const currentCGPs = guideline.clinicalGuidancePoints || [];
        
        // Update CGPs with clinician reviews
        const updatedCGPs = currentCGPs.map(cgp => {
            const review = reviews.find(r => r.cgpId === cgp.cgpId);
            
            if (review) {
                let newStatus = cgp.validationStatus;
                if (review.decision === 'approved') {
                    newStatus = 'clinician_approved';
                } else if (review.decision === 'rejected') {
                    newStatus = 'clinician_rejected';
                } else if (review.decision === 'modified') {
                    newStatus = 'clinician_modified';
                }
                
                return {
                    ...cgp,
                    guidance: review.modifiedGuidance !== undefined ? review.modifiedGuidance : cgp.guidance,
                    clinicalContext: review.modifiedContext !== undefined ? review.modifiedContext : cgp.clinicalContext,
                    validationStatus: newStatus,
                    clinicianReview: {
                        reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
                        reviewerId: userId,
                        decision: review.decision,
                        modifiedGuidance: review.modifiedGuidance || null,
                        modifiedContext: review.modifiedContext || null,
                        notes: review.notes || '',
                        hasDisagreement: cgp.validationStatus === 'disagreement' || cgp.validationStatus === 'arbitrated'
                    }
                };
            }
            
            return cgp;
        });
        
        // Determine overall approval state
        const allReviewed = updatedCGPs.every(cgp => cgp.clinicianReview !== null);
        const allApproved = updatedCGPs.every(cgp => 
            cgp.clinicianReview && cgp.clinicianReview.decision === 'approved'
        );
        const anyRejected = updatedCGPs.some(cgp => 
            cgp.clinicianReview && cgp.clinicianReview.decision === 'rejected'
        );
        
        let approvalStatus = 'clinician_review';
        if (allReviewed && allApproved) {
            approvalStatus = 'approved';
        } else if (anyRejected) {
            approvalStatus = 'rejected';
        }
        
        // Update guideline
        const updateData = {
            clinicalGuidancePoints: updatedCGPs,
            cgpApprovalState: {
                status: approvalStatus,
                currentStep: 'review',
                startedAt: guideline.cgpApprovalState?.startedAt || admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
                reviewedBy: userId,
                approvalDate: approvalStatus === 'approved' ? admin.firestore.FieldValue.serverTimestamp() : null
            },
            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (approvalStatus === 'approved') {
            updateData.cgpApprovalState.completedAt = admin.firestore.FieldValue.serverTimestamp();
        }
        
        await guidelineRef.update(updateData);
        
        res.json({
            success: true,
            cgps: updatedCGPs,
            approvalStatus: approvalStatus,
            allReviewed: allReviewed,
            allApproved: allApproved,
            guidelineId: guidelineId
        });
        
    } catch (error) {
        console.error('[CGP] Error in saveCGPClinicianReview endpoint:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get current CGP validation state for a guideline
 */
app.get('/getCGPValidationState/:guidelineId', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.params;
        
        if (!guidelineId) {
            return res.status(400).json({
                success: false,
                error: 'guidelineId is required'
            });
        }
        
        // Get guideline from Firestore
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({
                success: false,
                error: 'Guideline not found'
            });
        }
        
        const guideline = guidelineDoc.data();
        
        // Calculate statistics
        const cgps = guideline.clinicalGuidancePoints || [];
        const stats = {
            total: cgps.length,
            extracted: cgps.filter(c => c.validationStatus === 'extracted').length,
            validated: cgps.filter(c => c.validationStatus === 'validated').length,
            disagreement: cgps.filter(c => c.validationStatus === 'disagreement').length,
            arbitrated: cgps.filter(c => c.validationStatus === 'arbitrated').length,
            clinicianApproved: cgps.filter(c => c.validationStatus === 'clinician_approved').length,
            clinicianRejected: cgps.filter(c => c.validationStatus === 'clinician_rejected').length,
            clinicianModified: cgps.filter(c => c.validationStatus === 'clinician_modified').length,
            reviewed: cgps.filter(c => c.clinicianReview !== null).length,
            withDisagreement: cgps.filter(c => 
                c.validationStatus === 'disagreement' || 
                c.validationStatus === 'arbitrated' ||
                (c.clinicianReview && c.clinicianReview.hasDisagreement)
            ).length
        };
        
        res.json({
            success: true,
            guidelineId: guidelineId,
            approvalState: guideline.cgpApprovalState || { status: 'not_started' },
            cgps: cgps,
            validationLog: guideline.cgpValidationLog || {},
            statistics: stats
        });
        
    } catch (error) {
        console.error('[CGP] Error in getCGPValidationState endpoint:', error);
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
// ENHANCED AUDIT SYSTEM ENDPOINTS
// ============================================================================

// Helper function to generate scenario variations for an element
async function generateScenarioVariationsForElement(element, baseScenario, guidelineContent, aiProvider, userId) {
  const variations = [];
  
  // Generate threshold variations if thresholds exist
  if (element.thresholds && element.thresholds.length > 0) {
    for (const threshold of element.thresholds.slice(0, 2)) { // Limit to 2 threshold variations
      const variationPrompt = `Modify this clinical scenario to have ${threshold.variable} just below threshold (${threshold.thresholdValue}).

BASE SCENARIO:
${baseScenario.transcript}

Create a realistic variation with the threshold parameter modified.`;
      
      const response = await routeToAI({
        messages: [
          { role: 'system', content: 'You are generating clinical scenario variations for audit testing.' },
          { role: 'user', content: variationPrompt }
        ]
      }, userId, aiProvider);
      
      variations.push({
        type: 'threshold_variation',
        threshold: threshold.variable,
        direction: 'below',
        transcript: response.content || '',
        expectedGuidance: element.derivedAdvice
      });
    }
  }
  
  // Generate omission variations for required variables
  if (element.inputVariables) {
    const requiredVars = element.inputVariables.filter(v => v.required);
    for (const reqVar of requiredVars.slice(0, 2)) { // Limit to 2 omissions
      const omissionPrompt = `Modify this clinical scenario to omit information about ${reqVar.name}.

BASE SCENARIO:
${baseScenario.transcript}

Create a variation that is missing the ${reqVar.name} information.`;
      
      const response = await routeToAI({
        messages: [
          { role: 'system', content: 'You are generating clinical scenario variations for audit testing.' },
          { role: 'user', content: omissionPrompt }
        ]
      }, userId, aiProvider);
      
      variations.push({
        type: 'variable_omission',
        omittedVariable: reqVar.name,
        transcript: response.content || '',
        expectedGuidance: 'Should flag missing information'
      });
    }
  }
  
  return variations;
}

// Endpoint to generate systematic audit scenarios for an element
app.post('/generateAuditScenarios', authenticateUser, async (req, res) => {
  try {
    console.log('[AUDIT-SCENARIOS] Generating audit scenarios...');
    
    const {
      guidelineId,
      elementId,
      auditableElements,
      aiProvider = 'DeepSeek',
      options = {}
    } = req.body;
    
    if (!guidelineId || !auditableElements || !Array.isArray(auditableElements)) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: guidelineId and auditableElements array'
      });
    }
    
    // Get guideline content
    const guideline = await getGuideline(guidelineId);
    if (!guideline) {
      return res.status(404).json({ success: false, error: 'Guideline not found' });
    }
    const guidelineContent = guideline.condensed || guideline.content || '';
    
    // Generate scenarios for each element (or specific element if elementId provided)
    const elementsToProcess = elementId 
      ? auditableElements.filter(el => (el.elementId || el.name) === elementId)
      : auditableElements;
    
    const allScenarios = [];
    
    for (const element of elementsToProcess) {
      try {
        // Generate base scenario prompt
        const baseScenarioPrompt = `Generate a realistic clinical scenario transcript that would trigger this auditable element.

AUDITABLE ELEMENT:
- Name: ${element.name}
- Input Variables: ${JSON.stringify(element.inputVariables || [])}
- Derived Advice: ${element.derivedAdvice}
- Expected Guidance: ${element.expectedGuidance || element.derivedAdvice}

Generate a baseline clinical transcript.`;
        
        const baseScenarioResponse = await routeToAI({
          messages: [
            { role: 'system', content: 'You are a clinical scenario generator for audit testing.' },
            { role: 'user', content: baseScenarioPrompt }
          ]
        }, req.user.uid, aiProvider);
        
        const baseScenario = {
          transcript: baseScenarioResponse.content || '',
          elementId: element.elementId || element.name
        };
        
        // Generate variations
        const variations = await generateScenarioVariationsForElement(element, baseScenario, guidelineContent, aiProvider, req.user.uid);
        
        allScenarios.push({
          elementId: element.elementId || element.name,
          elementName: element.name,
          baseScenario: baseScenario.transcript,
          variations: variations,
          totalVariations: variations.length
        });
      } catch (error) {
        console.error(`[AUDIT-SCENARIOS] Error generating scenarios for element ${element.elementId}:`, error);
      }
    }
    
    // Store in Firestore
    const testId = db.collection('auditTests').doc().id;
    await db.collection('auditTests').doc(testId).set({
      testId,
      guidelineId,
      scenarios: allScenarios,
      totalElements: allScenarios.length,
      generatedBy: req.user.uid,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'created'
    });
    
    res.json({
      success: true,
      testId,
      scenarios: allScenarios,
      totalScenarios: allScenarios.reduce((sum, s) => sum + s.totalVariations, 0),
      generated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('[AUDIT-SCENARIOS] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate audit scenarios',
      details: error.message
    });
  }
});

// Endpoint to evaluate guidance multi-dimensionally
app.post('/evaluateGuidance', authenticateUser, async (req, res) => {
  try {
    console.log('[AUDIT-EVAL] Evaluating guidance...');
    
    const {
      guidance,
      expectedGuidance,
      element,
      scenario,
      testId,
      aiProvider = 'DeepSeek'
    } = req.body;
    
    if (!guidance || !expectedGuidance || !element) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters: guidance, expectedGuidance, element'
      });
    }
    
    const startTime = Date.now();
    
    // Multi-dimensional evaluation prompt
    const evalPrompt = `Evaluate this clinical guidance across multiple dimensions.

PROVIDED GUIDANCE:
${guidance}

EXPECTED GUIDANCE:
${expectedGuidance}

AUDITABLE ELEMENT:
${JSON.stringify(element, null, 2)}

EVALUATION CRITERIA:
1. Accuracy (0-100): Does guidance match expected advice?
2. Contextual Appropriateness (0-100): Is guidance appropriate for scenario?
3. Completeness (0-100): Are all required elements present?
4. Precision (0-100): Is guidance sufficiently specific?

Return JSON:
{
  "accuracyScore": number,
  "contextualScore": number,
  "completenessScore": number,
  "precisionScore": number,
  "overallScore": number,
  "issues": string[],
  "strengths": string[],
  "recommendations": string[]
}`;
    
    const evalResponse = await routeToAI({
      messages: [
        { role: 'system', content: 'You are an automated clinical guidance evaluator. Return only valid JSON.' },
        { role: 'user', content: evalPrompt }
      ]
    }, req.user.uid, aiProvider);
    
    const processingTimeMs = Date.now() - startTime;
    
    // Log interaction
    try {
      const { logAuditInteraction } = await import('./modules/audit-logging.js');
      await logAuditInteraction({
        guidelineId: element.guidelineId,
        elementId: element.elementId || element.name,
        testId: testId,
        promptChain: {
          systemPrompt: 'You are an automated clinical guidance evaluator. Return only valid JSON.',
          userPrompt: evalPrompt,
          fullPrompt: evalPrompt
        },
        response: evalResponse,
        modelConfig: {
          provider: evalResponse.ai_provider || aiProvider,
          model: evalResponse.ai_model || 'unknown'
        },
        tokenUsage: evalResponse.token_usage,
        endpoint: 'evaluateGuidance',
        userId: req.user.uid,
        processingTimeMs,
        context: {
          elementName: element.name,
          scenarioType: scenario?.type
        }
      });
    } catch (logError) {
      console.error('[AUDIT-EVAL] Error logging interaction:', logError);
    }
    
    // Parse JSON from response
    let evaluationResult;
    try {
      const jsonMatch = evalResponse.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        evaluationResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      return res.status(500).json({
        success: false,
        error: 'Failed to parse evaluation result',
        details: parseError.message
      });
    }
    
    // Calculate overall score if not provided
    if (!evaluationResult.overallScore) {
      evaluationResult.overallScore = Math.round(
        (evaluationResult.accuracyScore * 0.40) +
        (evaluationResult.contextualScore * 0.35) +
        (evaluationResult.completenessScore * 0.25)
      );
    }
    
    // Store result in Firestore
    const resultId = db.collection('auditResults').doc().id;
    await db.collection('auditResults').doc(resultId).set({
      resultId,
      testId: testId || null,
      elementId: element.elementId || element.name,
      scenarioId: scenario?.variationId || scenario?.id || null,
      evaluation: evaluationResult,
      guidance,
      expectedGuidance,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      resultId,
      evaluation: evaluationResult
    });
    
  } catch (error) {
    console.error('[AUDIT-EVAL] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to evaluate guidance',
      details: error.message
    });
  }
});

// Endpoint to get traceability matrix
app.get('/auditTraceability', authenticateUser, async (req, res) => {
  try {
    const { guidelineId } = req.query;
    
    if (!guidelineId) {
      return res.status(400).json({
        success: false,
        error: 'guidelineId is required'
      });
    }
    
    // Get traceability chain
    const tests = await db.collection('auditTests')
      .where('guidelineId', '==', guidelineId)
      .get();
    
    const elements = [];
    const scenarios = [];
    const interactions = [];
    const results = [];
    
    for (const testDoc of tests.docs) {
      const test = testDoc.data();
      
      // Get elements
      if (test.scenarios) {
        for (const scenarioGroup of test.scenarios) {
          if (scenarioGroup.elementId && !elements.find(e => e.elementId === scenarioGroup.elementId)) {
            elements.push({ elementId: scenarioGroup.elementId, elementName: scenarioGroup.elementName });
          }
        }
      }
      
      // Get scenarios
      if (test.scenarios) {
        scenarios.push(...test.scenarios.map(s => ({ ...s, testId: test.testId || testDoc.id })));
      }
      
      // Get interactions for this test
      const testInteractions = await db.collection('auditInteractions')
        .where('testId', '==', test.testId || testDoc.id)
        .get();
      interactions.push(...testInteractions.docs.map(d => d.data()));
      
      // Get results for this test
      const testResults = await db.collection('auditResults')
        .where('testId', '==', test.testId || testDoc.id)
        .get();
      results.push(...testResults.docs.map(d => d.data()));
    }
    
    const matrix = {
      guidelineId,
      elements,
      tests: tests.docs.map(d => ({ id: d.id, ...d.data() })),
      scenarios,
      interactions,
      results,
      summary: {
        totalElements: elements.length,
        totalTests: tests.size,
        totalScenarios: scenarios.length,
        totalInteractions: interactions.length,
        totalResults: results.length
      },
      generatedAt: new Date().toISOString()
    };
    
    // Store matrix
    await db.collection('traceabilityMatrix').doc(guidelineId).set({
      ...matrix,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    res.json({
      success: true,
      matrix
    });
    
  } catch (error) {
    console.error('[AUDIT-TRACEABILITY] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate traceability matrix',
      details: error.message
    });
  }
});

// Endpoint to generate audit report
app.post('/auditReport', authenticateUser, async (req, res) => {
  try {
    const {
      guidelineId,
      testId,
      format = 'json'
    } = req.body;
    
    if (!guidelineId && !testId) {
      return res.status(400).json({
        success: false,
        error: 'Either guidelineId or testId is required'
      });
    }
    
    // Get guideline
    let guideline = null;
    if (guidelineId) {
      guideline = await getGuideline(guidelineId);
    }
    
    // Get tests
    let testsQuery = db.collection('auditTests');
    if (testId) {
      testsQuery = testsQuery.where('testId', '==', testId);
    } else if (guidelineId) {
      testsQuery = testsQuery.where('guidelineId', '==', guidelineId);
    }
    const testsSnapshot = await testsQuery.get();
    const tests = testsSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    
    // Get all results
    const allResults = [];
    for (const test of tests) {
      const resultsSnapshot = await db.collection('auditResults')
        .where('testId', '==', test.testId || test.id)
        .get();
      allResults.push(...resultsSnapshot.docs.map(d => d.data()));
    }
    
    // Calculate statistics
    const stats = {
      totalTests: tests.length,
      totalResults: allResults.length,
      averageScore: 0,
      scoreDistribution: { excellent: 0, good: 0, needsImprovement: 0, poor: 0 }
    };
    
    if (allResults.length > 0) {
      const scores = allResults
        .filter(r => r.evaluation && r.evaluation.overallScore !== undefined)
        .map(r => r.evaluation.overallScore);
      
      if (scores.length > 0) {
        stats.averageScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        
        scores.forEach(score => {
          if (score >= 90) stats.scoreDistribution.excellent++;
          else if (score >= 75) stats.scoreDistribution.good++;
          else if (score >= 60) stats.scoreDistribution.needsImprovement++;
          else stats.scoreDistribution.poor++;
        });
      }
    }
    
    // Generate ISO-compliant report
    let isoReport = null;
    try {
      const { generateISOCompliantReport } = await import('./modules/audit-reporting.js');
      isoReport = await generateISOCompliantReport({
        guidelineId: guidelineId || tests[0]?.guidelineId,
        guidelineTitle: guideline?.title || guideline?.humanFriendlyName || 'Unknown',
        testId: testId || null,
        tests,
        results: allResults,
        statistics: stats,
        generatedBy: req.user.uid
      });
    } catch (error) {
      console.error('[AUDIT-REPORT] Error generating ISO report:', error);
      // Fall back to basic report
    }
    
    const report = isoReport || {
      reportId: db.collection('auditReports').doc().id,
      guidelineId: guidelineId || tests[0]?.guidelineId,
      guidelineTitle: guideline?.title || guideline?.humanFriendlyName || 'Unknown',
      testId: testId || null,
      tests,
      results: allResults,
      statistics: stats,
      generatedBy: req.user.uid,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      format,
      isoCompliant: false
    };
    
    // Store report
    await db.collection('auditReports').doc(report.reportId).set(report);
    
    res.json({
      success: true,
      report
    });
    
  } catch (error) {
    console.error('[AUDIT-REPORT] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate audit report',
      details: error.message
    });
  }
});

// Endpoint to get audit metrics
app.get('/auditMetrics', authenticateUser, async (req, res) => {
  try {
    const { guidelineId } = req.query;
    
    let testsQuery = db.collection('auditTests');
    if (guidelineId) {
      testsQuery = testsQuery.where('guidelineId', '==', guidelineId);
    }
    const testsSnapshot = await testsQuery.get();
    
    const metrics = {
      totalTests: testsSnapshot.size,
      totalScenarios: 0,
      totalInteractions: 0,
      totalResults: 0,
      averageScore: 0,
      totalTokens: 0,
      totalCost: 0,
      byGuideline: {},
      byElement: {}
    };
    
    // Process each test
    for (const testDoc of testsSnapshot.docs) {
      const test = testDoc.data();
      
      if (test.scenarios) {
        metrics.totalScenarios += test.scenarios.reduce((sum, s) => sum + (s.totalVariations || 0), 0);
      }
      
      // Get interactions
      const interactionsSnapshot = await db.collection('auditInteractions')
        .where('testId', '==', test.testId || testDoc.id)
        .get();
      metrics.totalInteractions += interactionsSnapshot.size;
      
      // Get token usage from interactions
      interactionsSnapshot.docs.forEach(doc => {
        const interaction = doc.data();
        if (interaction.tokenUsage) {
          metrics.totalTokens += interaction.tokenUsage.total_tokens || 0;
          if (interaction.tokenUsage.estimated_cost_usd) {
            metrics.totalCost += interaction.tokenUsage.estimated_cost_usd;
          }
        }
      });
      
      // Get results
      const resultsSnapshot = await db.collection('auditResults')
        .where('testId', '==', test.testId || testDoc.id)
        .get();
      metrics.totalResults += resultsSnapshot.size;
      
      // Aggregate scores
      const scores = resultsSnapshot.docs
        .map(d => d.data().evaluation?.overallScore)
        .filter(s => s !== undefined);
      
      if (scores.length > 0) {
        const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
        if (metrics.totalResults > 0) {
          metrics.averageScore = (metrics.averageScore * (metrics.totalResults - scores.length) + avgScore * scores.length) / metrics.totalResults;
        }
      }
    }
    
    res.json({
      success: true,
      metrics
    });
    
  } catch (error) {
    console.error('[AUDIT-METRICS] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get audit metrics',
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
    // Initialize step timer for profiling
    const timer = new StepTimer('/getAllGuidelines');
    req.stepTimer = timer;
    
    try {
        // Check if Firestore is initialized
        if (!db) {
            debugLog('[DEBUG] Firestore not initialized, returning empty guidelines with warning');
            return res.json({ 
                success: true, 
                guidelines: [],
                warning: 'Firestore not available - guidelines cannot be loaded',
                message: 'Application running in limited mode without guideline persistence'
            });
        }
        timer.step('Firestore check');

        // Fetch all guidelines from cache (or Firestore if cache expired)
        const allGuidelines = await getCachedGuidelines();
        timer.step('Fetch all guidelines');
        
        // Check if we got empty results due to authentication issues
        if (allGuidelines.length === 0) {
            return res.json({ 
                success: true, 
                guidelines: [],
                warning: 'No guidelines found in database',
                message: 'This could be due to authentication issues or empty collections'
            });
        }
        
        // Get user's hospital trust and preferences in PARALLEL for better performance
        const userId = req.user.uid;
        
        // Default preferences
        let userPreferences = {
            enabledOrganizations: ['RCOG', 'NICE', 'SIGN', 'BASHH', 'FSRH', 'WHO', 'BHIVA', 'BAPM', 'BSH', 'BJOG'],
            enabledTrusts: [],
            includeAllNational: true
        };
        
        // Run both queries in parallel
        const [userHospitalTrust, userPrefsDoc] = await Promise.all([
            getUserHospitalTrust(userId),
            db ? db.collection('userPreferences').doc(userId).get().catch(() => null) : Promise.resolve(null)
        ]);
        
        // Process user preferences if found
        if (userPrefsDoc && userPrefsDoc.exists) {
            const data = userPrefsDoc.data();
            userPreferences = {
                enabledOrganizations: data.enabledOrganizations || userPreferences.enabledOrganizations,
                enabledTrusts: data.enabledTrusts || userPreferences.enabledTrusts,
                includeAllNational: data.includeAllNational !== undefined ? data.includeAllNational : userPreferences.includeAllNational
            };
        }
        timer.step('Get user trust & preferences (parallel)');
        
        // Filter and prioritise guidelines based on user's trust and preferences
        // Priority: Local trust guidelines first, then national (filtered by organization preferences)
        const localGuidelines = [];
        const nationalGuidelines = [];
        const otherGuidelines = [];
        
        for (const guideline of allGuidelines) {
            // Default scope is 'national' if not specified (for backwards compatibility)
            const scope = guideline.scope || 'national';
            
            if (scope === 'local') {
                // Check if this local guideline matches user's enabled trusts
                const guidelineTrust = guideline.hospitalTrust;
                const isUserTrust = userHospitalTrust && guidelineTrust === userHospitalTrust;
                const isEnabledTrust = userPreferences.enabledTrusts.includes(guidelineTrust);
                
                if (isUserTrust || isEnabledTrust) {
                    localGuidelines.push(guideline);
                } else {
                    otherGuidelines.push(guideline);
                }
            } else if (scope === 'national' || !guideline.scope) {
                // Filter national guidelines by organization preferences
                if (userPreferences.includeAllNational) {
                    // If includeAllNational is true, show all national guidelines (backwards compatibility)
                    nationalGuidelines.push(guideline);
                } else {
                    // Otherwise, filter by enabled organizations
                    const organization = detectGuidelineOrganization(guideline);
                    
                    // If organization is detected and is in enabled list, include it
                    if (organization && userPreferences.enabledOrganizations.includes(organization)) {
                        nationalGuidelines.push(guideline);
                    } else if (!organization) {
                        // If organization cannot be detected, include it (to avoid hiding valid guidelines)
                        nationalGuidelines.push(guideline);
                    }
                    // Otherwise, exclude it
                }
            } else {
                // Other local guidelines not for this trust
                otherGuidelines.push(guideline);
            }
        }
        timer.step('Filter and categorize');
        
        // Combine in priority order: local first, then national, then others
        const sortedGuidelines = [...localGuidelines, ...nationalGuidelines, ...otherGuidelines];
        timer.step('Sort guidelines');
        
        res.json({ 
            success: true, 
            guidelines: sortedGuidelines,
            userHospitalTrust: userHospitalTrust,
            counts: {
                local: localGuidelines.length,
                national: nationalGuidelines.length,
                other: otherGuidelines.length
            }
        });
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

// Endpoint to get user's hospital trust preference
app.get('/getUserHospitalTrust', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const hospitalTrust = await getUserHospitalTrust(userId);
        
        res.json({ 
            success: true, 
            hospitalTrust: hospitalTrust 
        });
    } catch (error) {
        console.error('[ERROR] Failed to get user hospital trust:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to update user's hospital trust preference
app.post('/updateUserHospitalTrust', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { hospitalTrust } = req.body;
        
        if (!hospitalTrust) {
            return res.status(400).json({ 
                success: false, 
                error: 'Hospital trust is required' 
            });
        }
        
        const success = await updateUserHospitalTrust(userId, hospitalTrust);
        
        if (success) {
            res.json({ 
                success: true, 
                message: 'Hospital trust preference updated successfully' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to update hospital trust preference' 
            });
        }
    } catch (error) {
        console.error('[ERROR] Failed to update user hospital trust:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to get user's guideline scope preference
app.get('/getUserGuidelineScope', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const guidelineScope = await getUserGuidelineScope(userId);
        
        res.json({ 
            success: true, 
            guidelineScope: guidelineScope 
        });
    } catch (error) {
        console.error('[ERROR] Failed to get user guideline scope:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to detect if user input is a question or clinical note
app.post('/detectInputType', authenticateUser, async (req, res) => {
    try {
        const { text } = req.body;
        const userId = req.user.uid;
        
        if (!text || typeof text !== 'string' || text.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Text is required' 
            });
        }
        
        const trimmedText = text.trim();
        
        // Use LLM to determine if input is a question or clinical note
        const systemPrompt = `You are a clinical assistant that helps determine whether user input is a question about clinical guidelines or a clinical note/transcript.

A QUESTION typically:
- Asks for information, guidance, or explanation
- Starts with question words (what, when, where, who, why, how, which, can, could, should, would, is, are, etc.)
- Ends with a question mark
- Uses phrases like "please explain", "tell me", "what is", "how do", etc.
- Seeks knowledge or clarification

A CLINICAL NOTE typically:
- Describes a patient encounter, history, examination, or assessment
- Contains clinical data (age, vital signs, measurements, dates)
- Uses clinical terminology and structured format
- Describes symptoms, findings, or clinical events
- May include patient demographics, medical history, or treatment plans

Respond with ONLY one word: "question" or "note" (lowercase, no punctuation, no explanation).`;

        const userPrompt = `Determine if this input is a question or clinical note:

${trimmedText}`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
        
        debugLog('[DEBUG] detectInputType: Sending to LLM', {
            userId,
            textLength: trimmedText.length,
            textPreview: trimmedText.substring(0, 100)
        });
        
        // Get user's AI preference
        const preferredProvider = await getUserAIPreference(userId);
        const model = preferredProvider === 'DeepSeek' ? 'deepseek-chat' :
                     preferredProvider === 'OpenAI' ? 'gpt-3.5-turbo' :
                     preferredProvider === 'Anthropic' ? 'claude-3-sonnet' :
                     preferredProvider === 'Mistral' ? 'mistral-large' :
                     preferredProvider === 'Gemini' ? 'gemini-2.5-flash' :
                     preferredProvider === 'Groq' ? 'llama-3.3-70b-versatile' : 'deepseek-chat';
        
        const formattedMessages = formatMessagesForProvider(messages, preferredProvider);
        // Use a shorter timeout for fast UX when just detecting type
        const aiResult = await sendToAI(formattedMessages, model, null, userId, 0.3, 15000);
        
        if (!aiResult || !aiResult.content) {
            console.error('[ERROR] detectInputType: No response from AI');
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to get response from AI' 
            });
        }
        
        // Parse the response - should be "question" or "note"
        const responseText = aiResult.content.trim().toLowerCase();
        const isQuestion = responseText.includes('question');
        const isNote = responseText.includes('note');
        
        // Default to note if unclear
        const detectedType = isQuestion ? 'question' : 'note';
        
        debugLog('[DEBUG] detectInputType: Result', {
            userId,
            detectedType,
            aiResponse: responseText
        });
        
        res.json({ 
            success: true, 
            type: detectedType,
            isQuestion: isQuestion
        });
        
    } catch (error) {
        console.error('[ERROR] Failed to detect input type:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Failed to detect input type' 
        });
    }
});

// Endpoint to update user's guideline scope preference
app.post('/updateUserGuidelineScope', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { guidelineScope } = req.body;
        
        // Allow null to clear the preference
        if (guidelineScope !== null && (!guidelineScope || !guidelineScope.scope)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Guideline scope selection is required' 
            });
        }
        
        const success = await updateUserGuidelineScope(userId, guidelineScope);
        
        if (success) {
            res.json({ 
                success: true, 
                message: guidelineScope === null ? 'Guideline scope preference cleared successfully' : 'Guideline scope preference updated successfully' 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to update guideline scope preference' 
            });
        }
    } catch (error) {
        console.error('[ERROR] Failed to update user guideline scope:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to get user's guideline preferences
app.get('/getUserPreferences', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        
        // Default preferences structure
        const defaultPreferences = {
            enabledOrganizations: ['RCOG', 'NICE', 'SIGN', 'BASHH', 'FSRH', 'WHO', 'BHIVA', 'BAPM', 'BSH', 'BJOG'],
            enabledTrusts: [],
            includeAllNational: true // Backwards compatibility: show all national by default
        };
        
        if (db) {
            try {
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                
                if (userPrefsDoc.exists) {
                    const data = userPrefsDoc.data();
                    // Merge with defaults, ensuring arrays exist
                    const preferences = {
                        enabledOrganizations: data.enabledOrganizations || defaultPreferences.enabledOrganizations,
                        enabledTrusts: data.enabledTrusts || defaultPreferences.enabledTrusts,
                        includeAllNational: data.includeAllNational !== undefined ? data.includeAllNational : defaultPreferences.includeAllNational
                    };
                    
                    res.json({ 
                        success: true, 
                        preferences: preferences
                    });
                    return;
                }
            } catch (firestoreError) {
                console.error('Firestore error in getUserPreferences, returning defaults:', firestoreError);
            }
        }
        
        // Return default preferences if no user preferences found
        res.json({ 
            success: true, 
            preferences: defaultPreferences
        });
    } catch (error) {
        console.error('[ERROR] Failed to get user preferences:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to save user's guideline preferences
app.post('/saveUserPreferences', authenticateUser, async (req, res) => {
    try {
        const userId = req.user.uid;
        const { enabledOrganizations, enabledTrusts, includeAllNational } = req.body;
        
        // Validate input
        if (!Array.isArray(enabledOrganizations)) {
            return res.status(400).json({ 
                success: false, 
                error: 'enabledOrganizations must be an array' 
            });
        }
        
        if (!Array.isArray(enabledTrusts)) {
            return res.status(400).json({ 
                success: false, 
                error: 'enabledTrusts must be an array' 
            });
        }
        
        const preferences = {
            enabledOrganizations: enabledOrganizations,
            enabledTrusts: enabledTrusts,
            includeAllNational: includeAllNational !== undefined ? includeAllNational : true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (db) {
            try {
                // Get existing preferences to preserve other fields (like hospitalTrust)
                const userPrefsDoc = await db.collection('userPreferences').doc(userId).get();
                const existingData = userPrefsDoc.exists ? userPrefsDoc.data() : {};
                
                await db.collection('userPreferences').doc(userId).set({
                    ...existingData,
                    ...preferences
                }, { merge: true });
                
                console.log(`Successfully saved user preferences for user: ${userId}`);
                res.json({ 
                    success: true, 
                    message: 'Preferences saved successfully',
                    preferences: preferences
                });
                return;
            } catch (firestoreError) {
                console.error('Firestore error in saveUserPreferences:', firestoreError);
                return res.status(500).json({ 
                    success: false, 
                    error: 'Failed to save preferences to database' 
                });
            }
        }
        
        // Fallback: try file storage
        try {
            const userPrefsFilePath = path.join(userPrefsDir, `${userId}.json`);
            const existingData = fs.existsSync(userPrefsFilePath) 
                ? JSON.parse(fs.readFileSync(userPrefsFilePath, 'utf8')) 
                : {};
            
            const updatedData = {
                ...existingData,
                ...preferences,
                updatedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(userPrefsFilePath, JSON.stringify(updatedData, null, 2));
            
            res.json({ 
                success: true, 
                message: 'Preferences saved successfully',
                preferences: preferences
            });
        } catch (fileError) {
            console.error('File storage error in saveUserPreferences:', fileError);
            res.status(500).json({ 
                success: false, 
                error: 'Failed to save preferences' 
            });
        }
    } catch (error) {
        console.error('[ERROR] Failed to save user preferences:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Helper function to determine correct nation based on organization
function getCorrectNationForOrganization(organization) {
    if (!organization) {
        return 'England & Wales'; // Default
    }
    
    const org = organization.toUpperCase();
    
    // SIGN is Scotland-only
    if (org === 'SIGN' || org.includes('SCOTTISH INTERCOLLEGIATE')) {
        return 'Scotland';
    }
    
    // NICE is England & Wales only
    if (org === 'NICE') {
        return 'England & Wales';
    }
    
    // RCOG, GTG, BJOG are UK-wide, default to England & Wales
    if (org === 'RCOG' || org === 'GTG' || org === 'BJOG' || 
        org.includes('ROYAL COLLEGE OF OBSTETRICIANS') || 
        org.includes('GREEN-TOP') || 
        org.includes('BRITISH JOURNAL')) {
        return 'England & Wales';
    }
    
    // All other organizations default to England & Wales
    return 'England & Wales';
}

// Endpoint to fix incorrect nation classifications
app.post('/fixNationClassifications', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ 
                success: false, 
                error: 'Admin access required' 
            });
        }
        
        if (!db) {
            return res.status(500).json({ 
                success: false, 
                error: 'Firestore not available' 
            });
        }
        
        console.log('[FIX_NATIONS] Starting nation classification fix...');
        
        // Get all guidelines
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const allGuidelines = [];
        guidelinesSnapshot.forEach(doc => {
            allGuidelines.push({ id: doc.id, ...doc.data() });
        });
        
        console.log(`[FIX_NATIONS] Found ${allGuidelines.length} guidelines to check`);
        
        const updates = [];
        const stats = {
            checked: 0,
            fixed: 0,
            skipped: 0,
            errors: 0
        };
        
        // Process each guideline
        for (const guideline of allGuidelines) {
            stats.checked++;
            
            // Only process national guidelines
            if (guideline.scope !== 'national') {
                stats.skipped++;
                continue;
            }
            
            try {
                // Detect organization
                const organization = detectGuidelineOrganization(guideline);
                
                // Determine correct nation
                const correctNation = getCorrectNationForOrganization(organization);
                
                // Check if current nation is incorrect
                const currentNation = guideline.nation;
                
                if (currentNation !== correctNation) {
                    console.log(`[FIX_NATIONS] Fixing: ${guideline.title || guideline.filename}`);
                    console.log(`  Organization: ${organization || 'Unknown'}`);
                    console.log(`  Current: ${currentNation || 'null'} -> Correct: ${correctNation}`);
                    
                    updates.push({
                        id: guideline.id,
                        organization: organization,
                        oldNation: currentNation,
                        newNation: correctNation,
                        title: guideline.title || guideline.filename
                    });
                    stats.fixed++;
                } else {
                    stats.skipped++;
                }
            } catch (error) {
                console.error(`[FIX_NATIONS] Error processing guideline ${guideline.id}:`, error);
                stats.errors++;
            }
        }
        
        // Apply updates in batches (Firestore limit is 500 per batch)
        const BATCH_SIZE = 500;
        let totalUpdated = 0;
        
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const batchUpdates = updates.slice(i, i + BATCH_SIZE);
            
            for (const update of batchUpdates) {
                const docRef = db.collection('guidelines').doc(update.id);
                batch.update(docRef, {
                    nation: update.newNation,
                    nationFixedAt: admin.firestore.FieldValue.serverTimestamp()
                });
            }
            
            await batch.commit();
            totalUpdated += batchUpdates.length;
            console.log(`[FIX_NATIONS] Updated batch: ${totalUpdated}/${updates.length}`);
        }
        
        console.log(`[FIX_NATIONS] Complete! Fixed ${totalUpdated} guidelines`);
        
        res.json({
            success: true,
            message: `Fixed ${totalUpdated} guideline nation classifications`,
            stats: {
                ...stats,
                updated: totalUpdated
            },
            sampleUpdates: updates.slice(0, 10) // Show first 10 as examples
        });
    } catch (error) {
        console.error('[FIX_NATIONS] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to get list of available hospital trusts
app.get('/getHospitalTrustsList', authenticateUser, async (req, res) => {
    try {
        // Read hospital trusts from JSON file
        const hospitalTrustsPath = path.join(__dirname, 'hospital-trusts.json');
        const hospitalTrustsData = JSON.parse(fs.readFileSync(hospitalTrustsPath, 'utf8'));
        
        res.json({ 
            success: true, 
            trusts: hospitalTrustsData.regions['England & Wales'].trusts,
            allRegions: hospitalTrustsData.regions
        });
    } catch (error) {
        console.error('[ERROR] Failed to get hospital trusts list:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
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

        debugLog('[DEBUG] Admin user authorized for deletion:', req.user.email);

        // Get all summaries
        const summariesSnapshot = await db.collection('guidelineSummaries').get();
        console.log(`[DEBUG] Found ${summariesSnapshot.size} summaries to delete`);

        // Delete in batches
        const batch = db.batch();
        summariesSnapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();

        debugLog('[DEBUG] Successfully deleted all summaries');
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

        debugLog('[DEBUG] Admin user authorized for deletion:', req.user.email);

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

        debugLog('[DEBUG] Successfully deleted all guideline data');
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
    debugLog('[DEBUG] Starting guideline ID check and migration process');
    
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
      debugLog('[DEBUG] Committing changes to Firestore...');
      await batch.commit();
      debugLog('[DEBUG] Changes committed successfully');
    } else {
      debugLog('[DEBUG] No changes needed, skipping commit');
    }

    debugLog('[DEBUG] Migration process completed', results);
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

    debugLog('[DEBUG] Admin user authorized for migration:', req.user.email);
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
    // debugLog('[DEBUG] getAllGuidelines function called');
    
    // Check if database is available
    if (!db) {
      debugLog('[DEBUG] Firestore database not available, returning empty guidelines');
      return [];
    }

    // NOTE: Migration functions removed from critical path for performance
    // Migrations should be run via admin endpoint or background job, not on every request
    // See /migrate-guideline-ids endpoint for manual migration trigger

    debugLog('[DEBUG] Fetching guidelines from single collection');
    
    // Add timeout and better error handling for Firestore queries
    const timeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Firestore query timeout')), 10000)
    );

    // Simplified: only fetch from guidelines collection since data is now consolidated
    const guidelines = await Promise.race([
      db.collection('guidelines').get(),
      timeout
    ]);

    debugLog('[DEBUG] Guidelines collection size:', guidelines.size);

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
      
      // Reduced logging for performance - only log in development if needed
      // console.log(`[DEBUG] Processing guideline: ${doc.id}`);
      
      result.push({
        ...data,
        id: doc.id,
        condensed: data.condensed || condensedFromCollection || null // Prefer document field, fallback to collection
      });
    });
    debugLog('[DEBUG] Returning', result.length, 'guidelines');
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
      debugLog('[DEBUG] Returning empty guidelines due to authentication/connectivity issues');
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
    
    // Handle displayName: if provided, use it directly (manual override)
    // If not provided but title/humanFriendlyName changed, auto-generate displayName
    if (updates.displayName !== undefined) {
      // Manual override - use provided displayName as-is
      // (could be empty string to clear it, or a custom value)
    } else if (updates.title || updates.humanFriendlyName) {
      // Auto-generate displayName if title or humanFriendlyName is being updated
      const guidelineRef = db.collection('guidelines').doc(id);
      const currentDoc = await guidelineRef.get();
      const currentData = currentDoc.data();
      
      const sourceTitle = updates.title || currentData.title;
      const sourceHumanFriendly = updates.humanFriendlyName || currentData.humanFriendlyName;
      const nameToUse = sourceHumanFriendly || sourceTitle;
      
      if (nameToUse) {
        updates.displayName = generateDisplayName(nameToUse);
        console.log(`[DEBUG] Auto-generated displayName for ${id}: "${updates.displayName}"`);
      }
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

// Endpoint to populate displayName for all existing guidelines
app.post('/populateDisplayNames', authenticateUser, async (req, res) => {
  try {
    const { guidelineId } = req.body;
    
    // If specific guidelineId provided, update only that one
    if (guidelineId) {
      const guidelineRef = db.collection('guidelines').doc(guidelineId);
      const doc = await guidelineRef.get();
      
      if (!doc.exists) {
        return res.status(404).json({ error: 'Guideline not found' });
      }
      
      const data = doc.data();
      const sourceName = data.humanFriendlyName || data.title || data.filename;
      
      if (!sourceName) {
        return res.status(400).json({ error: 'No source name found to generate displayName' });
      }
      
      // Always try AI generation first to get best quality displayName with proper acronym handling
      const userId = req.user.uid;
      let displayName = await generateDisplayNameWithAI(data, userId);
      if (!displayName) {
        console.log(`[POPULATE_DISPLAY_NAMES] AI generation failed for ${guidelineId}, using rule-based fallback`);
        displayName = generateDisplayName(sourceName);
      }
      
      await guidelineRef.update({
        displayName: displayName,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({
        success: true,
        updated: 1,
        results: [{
          guidelineId: guidelineId,
          oldTitle: sourceName,
          newDisplayName: displayName
        }]
      });
    }
    
    // Otherwise, queue jobs for all guidelines that need processing
    // This returns immediately and processes in the background to avoid timeouts
    const guidelinesSnapshot = await db.collection('guidelines').get();
    const guidelinesToProcess = [];
    
    // Filter guidelines that need processing
    for (const doc of guidelinesSnapshot.docs) {
      const data = doc.data();
      
      // Skip if displayName already exists (unless force flag is set)
      if (data.displayName && !req.body.force) {
        continue;
      }
      
      const sourceName = data.humanFriendlyName || data.title || data.filename;
      if (!sourceName) {
        continue;
      }
      
      guidelinesToProcess.push(doc.id);
    }
    
    console.log(`[POPULATE_DISPLAY_NAMES] Queueing ${guidelinesToProcess.length} guidelines for background processing`);
    
    // Queue jobs for each guideline - these will be processed by the background job processor
    for (const guidelineId of guidelinesToProcess) {
      queueJob('generate_display_name', guidelineId);
    }
    
    res.json({
      success: true,
      message: `Queued ${guidelinesToProcess.length} guidelines for display name regeneration. Processing in background...`,
      queued: guidelinesToProcess.length,
      total: guidelinesSnapshot.size
    });
  } catch (error) {
    console.error('[POPULATE_DISPLAY_NAMES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to clear all displayName fields
app.post('/clearDisplayNames', authenticateUser, async (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const { confirm } = req.body;
    if (confirm !== 'yes') {
      return res.status(400).json({ 
        error: 'Confirmation required. Send { "confirm": "yes" } to proceed.' 
      });
    }
    
    const guidelinesSnapshot = await db.collection('guidelines').get();
    let clearedCount = 0;
    let batch = db.batch();
    let batchCount = 0;
    const BATCH_SIZE = 500;
    
    for (const doc of guidelinesSnapshot.docs) {
      const data = doc.data();
      
      // Only clear if displayName exists
      if (data.displayName) {
        const guidelineRef = db.collection('guidelines').doc(doc.id);
        batch.update(guidelineRef, {
          displayName: admin.firestore.FieldValue.delete(),
          'processingStatus.displayNameGenerated': false,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        });
        
        batchCount++;
        clearedCount++;
        
        // Commit batch when it reaches the limit
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          console.log(`[CLEAR_DISPLAY_NAMES] Cleared batch of ${batchCount} displayNames`);
          batch = db.batch();
          batchCount = 0;
        }
      }
    }
    
    // Commit remaining updates
    if (batchCount > 0) {
      await batch.commit();
      console.log(`[CLEAR_DISPLAY_NAMES] Cleared final batch of ${batchCount} displayNames`);
    }
    
    console.log(`[CLEAR_DISPLAY_NAMES] Successfully cleared ${clearedCount} displayName fields`);
    
    res.json({
      success: true,
      cleared: clearedCount,
      total: guidelinesSnapshot.size
    });
  } catch (error) {
    console.error('[CLEAR_DISPLAY_NAMES] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update getAllGuidelines to use document IDs
async function getAllGuidelines() {
    try {
        // debugLog('[DEBUG] getAllGuidelines function called');
        
        if (!db) {
            debugLog('[DEBUG] Firestore database not available, returning empty guidelines');
            return [];
        }

        debugLog('[DEBUG] Fetching guidelines collections from Firestore');
        
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

        // debugLog('[DEBUG] Collection sizes:', {
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
    // Initialize step timer for profiling
    const timer = new StepTimer('/dynamicAdvice');
    req.stepTimer = timer;
    
    try {
        debugLog('[DEBUG] dynamicAdvice endpoint called');
        const { transcript, analysis, guidelineId, guidelineTitle } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!transcript) {
            debugLog('[DEBUG] dynamicAdvice: Missing transcript');
            return res.status(400).json({ success: false, error: 'Transcript is required' });
        }
        
        if (!analysis) {
            debugLog('[DEBUG] dynamicAdvice: Missing analysis');
            return res.status(400).json({ success: false, error: 'Analysis is required' });
        }
        timer.step('Validation');

        debugLog('[DEBUG] dynamicAdvice request data:', {
            userId,
            transcriptLength: transcript.length,
            analysisLength: analysis.length,
            guidelineId,
            guidelineTitle
        });

        // Fetch guideline content for verbatim quote extraction
        let guidelineContent = '';
        let semanticallyCompressedContent = ''; // Fallback for context length exceeded
        let resolvedGuidelineTitle = guidelineTitle || 'Unknown';
        let guidelineFilename = null;
        let feedbackSummary = null;
        let feedbackLastSummarised = null;
        
        if (guidelineId) {
            try {
                console.log(`[DEBUG] dynamicAdvice: Fetching guideline content for ID: ${guidelineId}`);
                
                const [guidelineDoc, condensedDoc, compressedDoc] = await Promise.all([
                    db.collection('guidelines').doc(guidelineId).get(),
                    db.collection('guidelineCondensed').doc(guidelineId).get(),
                    db.collection('guidelineSemanticallyCompressed').doc(guidelineId).get()
                ]);

                if (guidelineDoc.exists) {
                    const guidelineData = guidelineDoc.data();
                    const condensedData = condensedDoc.exists ? condensedDoc.data() : null;
                    const compressedData = compressedDoc.exists ? compressedDoc.data() : null;
                    
                    // Get content - prefer condensed version for better performance
                    guidelineContent = condensedData?.condensed || guidelineData.content || guidelineData.condensed || '';
                    
                    // Store semantically compressed version for fallback if context length exceeded
                    semanticallyCompressedContent = compressedData?.semanticallyCompressed || compressedData?.compressed || '';
                    
                    // Get proper title
                    resolvedGuidelineTitle = guidelineData.humanFriendlyTitle || guidelineData.title || guidelineData.fileName || guidelineTitle || 'Unknown';
                    
                    // Get filename for PDF viewing
                    guidelineFilename = guidelineData.filename || guidelineData.originalFilename;
                    
                    // Get feedback summary if available and recent (within 30 days)
                    if (guidelineData.feedbackSummary && guidelineData.feedbackLastSummarised) {
                        const summaryDate = guidelineData.feedbackLastSummarised.toDate ? 
                            guidelineData.feedbackLastSummarised.toDate() : new Date(guidelineData.feedbackLastSummarised);
                        const daysSinceSummary = (Date.now() - summaryDate.getTime()) / (1000 * 60 * 60 * 24);
                        
                        if (daysSinceSummary <= 30) {
                            feedbackSummary = guidelineData.feedbackSummary;
                            feedbackLastSummarised = summaryDate;
                            console.log(`[DEBUG] dynamicAdvice: Using feedback summary (${Math.round(daysSinceSummary)} days old, ${guidelineData.feedbackSummarisedCount || 0} feedback entries)`);
                        } else {
                            console.log(`[DEBUG] dynamicAdvice: Feedback summary too old (${Math.round(daysSinceSummary)} days), not using`);
                        }
                    }
                    
                    console.log(`[DEBUG] dynamicAdvice: Retrieved guideline content`, {
                        guidelineId,
                        contentLength: guidelineContent.length,
                        semanticallyCompressedLength: semanticallyCompressedContent.length,
                        contentSource: condensedData?.condensed ? 'condensed' : guidelineData.content ? 'full' : 'missing',
                        contentSample: guidelineContent.length > 0 ? guidelineContent.substring(0, 500) : 'EMPTY CONTENT',
                        hasFeedbackSummary: !!feedbackSummary,
                        hasSemanticFallback: semanticallyCompressedContent.length > 0
                    });
                } else {
                    console.warn(`[DEBUG] dynamicAdvice: Guideline not found with ID: ${guidelineId}`);
                }
            } catch (fetchError) {
                console.error(`[DEBUG] dynamicAdvice: Error fetching guideline:`, fetchError);
                // Continue without guideline content - will use analysis only
            }
        } else {
            console.log(`[DEBUG] dynamicAdvice: No guidelineId provided, proceeding without guideline content`);
        }
        timer.step('Fetch guideline content');

        // Create AI prompt to convert analysis into structured suggestions
        const systemPrompt = `You are a medical AI assistant that converts clinical guideline analysis into structured, actionable suggestions. 

Your task is to analyze the provided guideline analysis and extract specific, actionable suggestions that can be presented to the user for acceptance, rejection, or modification.

CLINICAL REASONING GUIDELINES:
- First understand the specific clinical scenario and current diagnosis from the transcript
- Assess whether each potential recommendation is appropriate and indicated for this clinical scenario
- When the transcript is brief or lacks detail, suggest guideline-recommended actions that are generally indicated for the presenting condition
- Provide context explaining when/why the suggestion would be appropriate
- Do not reject suggestions solely because transcript lacks sufficient detail to confirm every criterion
- Apply the principle: "Would this investigation or intervention improve patient care in this type of scenario?"
- Consider the clinical context: is this an acute emergency, established diagnosis, or uncertain diagnostic situation?

GENERAL CLINICAL APPROPRIATENESS PRINCIPLES:
- Generally avoid suggesting diagnostic investigations when the diagnosis is already clearly established
- Avoid recommending interventions that directly conflict with the current evidence-based management plan
- When transcript details are limited, err on the side of suggesting guideline-recommended actions with appropriate context
- Evaluate whether the suggestion would be helpful for the general clinical scenario described

LEARNED CLINICAL PATTERNS:
When available, you will be provided with aggregated feedback from experienced clinicians about this guideline's application. This feedback represents real-world clinical wisdom about when certain recommendations may not be appropriate. Consider these patterns alongside the guideline text when making suggestions.

For each suggestion you identify, return ONLY a valid JSON object with the following structure:
{
  "suggestions": [
    {
      "id": "1",
      "originalText": "text from transcript that needs changing OR description of missing element",
      "suggestedText": "proposed replacement text",
      "context": "detailed explanation of why this change is suggested, including relevant quoted text from the guideline in quotation marks, and confirmation that this recommendation is appropriate for the specific clinical scenario",
      "hasVerbatimQuote": true,
      "category": "addition|modification|deletion|formatting",
      "priority": "high|medium|low",
      "guidelineReference": "specific guideline section or rule"
    }
  ]
}

CRITICAL - hasVerbatimQuote field:
- Set to true ONLY if the context field contains text EXACTLY copied from the Full Guideline Content in quotation marks
- Set to false if paraphrasing guideline recommendations or if exact quotes are not available
- This field enables PDF highlighting, so accuracy is essential

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
- Reference specific guideline recommendations or requirements
- Explain the clinical rationale behind the suggestion
- State why this recommendation is indicated in this particular clinical scenario
- Make the context informative and educational
- DO NOT add meta-commentary like "this text appears in the guideline" or "this is from the guideline content"

CRITICAL QUOTING GUIDELINES:
- ONLY use quotation marks around text that is EXACTLY copied verbatim from the Full Guideline Content provided
- Before adding quotation marks, verify the exact text exists in the Full Guideline Content section
- Set hasVerbatimQuote to true ONLY when you include exact quoted text in the context field
- Set hasVerbatimQuote to false when paraphrasing or when no exact match can be found
- PREFER verbatim quotes when available as they enable PDF highlighting for users
- When paraphrasing, use phrases like "The guideline recommends..." WITHOUT quotation marks
- Example with verbatim quote (hasVerbatimQuote: true): 
  context: "The patient requires major PPH management. The guideline states: 'Immediate venepuncture (20 ml) for: cross-match (4 units minimum)' for major PPH with ongoing bleeding."
- Example with paraphrase (hasVerbatimQuote: false): 
  context: "The guideline recommends cross-matching at least 4 units for major PPH with blood loss exceeding 1000ml and ongoing bleeding."
- DO NOT fabricate or approximate quotes - if you cannot find exact text, set hasVerbatimQuote to false and paraphrase clearly
- DO NOT add phrases like "this exact text appears in the guideline" or similar meta-commentary
- If Full Guideline Content is unavailable or condensed, set hasVerbatimQuote to false and paraphrase accurately

Other important guidelines:
- Only suggest changes that are explicitly supported by the guideline analysis AND clinically appropriate for the specific scenario
- Make suggestions specific and actionable
- For modifications, ensure original text selections are precise and findable in the transcript
- Prioritize suggestions based on clinical importance and appropriateness
- When transcript details are limited, suggest guideline-recommended actions that are generally appropriate for the presenting condition, with appropriate context
- If no clinically appropriate suggestions can be made that are supported by the guideline, return {"suggestions": []}`;

        const userPrompt = `Original Transcript:
${transcript}

Full Guideline Content:
${guidelineContent || 'Guideline content not available - use analysis only'}

Guideline Analysis:
${analysis}

Guideline: ${resolvedGuidelineTitle}
${feedbackSummary ? `

CLINICAL FEEDBACK FROM PREVIOUS USERS:
The following patterns have been identified from clinician feedback on this guideline:

${feedbackSummary}

Please consider this feedback when determining if suggestions are appropriate for this specific case.` : ''}

Please extract actionable suggestions from this analysis and format them as specified. For each suggestion, include detailed context with relevant information from the guideline. 

CRITICAL QUOTING REQUIREMENTS:
- Search the "Full Guideline Content" section for EXACT text matches before adding quotes
- ONLY use quotation marks if you can copy the text VERBATIM from the Full Guideline Content
- Set hasVerbatimQuote to true ONLY when using exact quoted text from the guideline
- Set hasVerbatimQuote to false when paraphrasing or when exact text cannot be found
- Accuracy is essential - verbatim quotes enable PDF highlighting for the user
- When in doubt, use hasVerbatimQuote: false and paraphrase clearly
- DO NOT add meta-commentary about whether text appears in the guideline - just provide the quote or paraphrase

CONTEXT FIELD EXAMPLES:
Example 1 - With verbatim quote (hasVerbatimQuote: true):
"For major PPH with ongoing bleeding, the guideline specifies: 'Immediate venepuncture (20 ml) for: cross-match (4 units minimum)' - therefore the current order for 2 units is insufficient."

Example 2 - With paraphrase (hasVerbatimQuote: false):
"The guideline recommends cross-matching a minimum of 4 units for major postpartum haemorrhage with blood loss exceeding 1000ml and ongoing bleeding. The current order for 2 units is below this recommendation."

IMPORTANT: 
- Make actionable suggestions that are supported by the guideline and clinically appropriate
- When transcript details are limited, suggest guideline-recommended actions appropriate for the presenting condition
- Prioritise accuracy over quantity - better to have fewer suggestions with accurate quotes than many with fabricated ones
- The context field should be informative and educational - avoid meta-commentary about the guideline itself`;

        debugLog('[DEBUG] dynamicAdvice: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            guidelineContentLength: guidelineContent.length,
            hasGuidelineContent: guidelineContent.length > 0,
            guidelineContentSample: guidelineContent.substring(0, 200) + '...'
        });
        timer.step('Build prompts');

        // Send to AI with lower temperature for more accurate quote extraction
        // Use retry logic with fallback to semantically compressed content if context length exceeded
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        let aiResponse;
        let usedFallback = false;
        
        try {
            aiResponse = await routeToAI({ messages, temperature: 0.3 }, userId);
        } catch (aiError) {
            // Check if error is due to context length exceeded
            const isContextLengthError = aiError.message && (
                aiError.message.includes('maximum context length') ||
                aiError.message.includes('context_length_exceeded') ||
                aiError.message.includes('too many tokens')
            );
            
            if (isContextLengthError && (semanticallyCompressedContent || guidelineContent.length > 20000)) {
                debugLog('[DEBUG] dynamicAdvice: Context length exceeded, attempting fallback with compressed content');
                
                // Determine fallback content - use semantically compressed if available, otherwise truncate
                let fallbackContent = '';
                if (semanticallyCompressedContent && semanticallyCompressedContent.length > 0) {
                    fallbackContent = semanticallyCompressedContent;
                    console.log(`[DEBUG] dynamicAdvice: Using semantically compressed content (${fallbackContent.length} chars)`);
                } else {
                    // Truncate the guideline content to ~20k chars
                    const MAX_FALLBACK_LENGTH = 20000;
                    fallbackContent = guidelineContent.substring(0, MAX_FALLBACK_LENGTH);
                    if (guidelineContent.length > MAX_FALLBACK_LENGTH) {
                        fallbackContent += '\n...[Content truncated due to length]...';
                    }
                    console.log(`[DEBUG] dynamicAdvice: Using truncated content (${fallbackContent.length} chars from ${guidelineContent.length})`);
                }
                
                // Rebuild the user prompt with compressed/truncated content
                const fallbackUserPrompt = `Original Transcript:
${transcript}

Full Guideline Content:
${fallbackContent || 'Guideline content not available - use analysis only'}

Guideline Analysis:
${analysis}

Guideline: ${resolvedGuidelineTitle}
${feedbackSummary ? `

CLINICAL FEEDBACK FROM PREVIOUS USERS:
The following patterns have been identified from clinician feedback on this guideline:

${feedbackSummary}

Please consider this feedback when determining if suggestions are appropriate for this specific case.` : ''}

Please extract actionable suggestions from this analysis and format them as specified. For each suggestion, include detailed context with relevant information from the guideline. 

CRITICAL QUOTING REQUIREMENTS:
- Search the "Full Guideline Content" section for EXACT text matches before adding quotes
- ONLY use quotation marks if you can copy the text VERBATIM from the Full Guideline Content
- Set hasVerbatimQuote to true ONLY when using exact quoted text from the guideline
- Set hasVerbatimQuote to false when paraphrasing or when exact text cannot be found
- Accuracy is essential - verbatim quotes enable PDF highlighting for the user
- When in doubt, use hasVerbatimQuote: false and paraphrase clearly
- DO NOT add meta-commentary about whether text appears in the guideline - just provide the quote or paraphrase

CONTEXT FIELD EXAMPLES:
Example 1 - With verbatim quote (hasVerbatimQuote: true):
"For major PPH with ongoing bleeding, the guideline specifies: 'Immediate venepuncture (20 ml) for: cross-match (4 units minimum)' - therefore the current order for 2 units is insufficient."

Example 2 - With paraphrase (hasVerbatimQuote: false):
"The guideline recommends cross-matching a minimum of 4 units for major postpartum haemorrhage with blood loss exceeding 1000ml and ongoing bleeding. The current order for 2 units is below this recommendation."

IMPORTANT: 
- Make actionable suggestions that are supported by the guideline and clinically appropriate
- When transcript details are limited, suggest guideline-recommended actions appropriate for the presenting condition
- Prioritise accuracy over quantity - better to have fewer suggestions with accurate quotes than many with fabricated ones
- The context field should be informative and educational - avoid meta-commentary about the guideline itself`;

                messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fallbackUserPrompt }
                ];
                
                debugLog('[DEBUG] dynamicAdvice: Retrying with fallback content', {
                    fallbackUserPromptLength: fallbackUserPrompt.length,
                    fallbackContentLength: fallbackContent.length
                });
                
                aiResponse = await routeToAI({ messages, temperature: 0.3 }, userId);
                usedFallback = true;
            } else {
                // Re-throw if not a context length error or no fallback available
                throw aiError;
            }
        }
        
        if (usedFallback) {
            debugLog('[DEBUG] dynamicAdvice: Successfully completed with fallback content');
        }
        
        debugLog('[DEBUG] dynamicAdvice: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        timer.step('AI API call');
        
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
            debugLog('[DEBUG] dynamicAdvice: Parsed suggestions directly:', {
                count: suggestions.length,
                categories: suggestions.map(s => s.category)
            });
        } catch (parseError) {
            debugLog('[DEBUG] dynamicAdvice: Direct JSON parse failed, trying to extract from markdown:', {
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
                    debugLog('[DEBUG] dynamicAdvice: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        debugLog('[DEBUG] dynamicAdvice: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                debugLog('[DEBUG] dynamicAdvice: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                const parsedResponse = JSON.parse(jsonContent);
                suggestions = parsedResponse.suggestions || [];
                
                debugLog('[DEBUG] dynamicAdvice: Successfully parsed extracted JSON:', {
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
                debugLog('[DEBUG] dynamicAdvice: Using final fallback suggestion format');
                
                // Log the full raw content for debugging
                console.error('[DEBUG] dynamicAdvice: Full raw AI response for debugging:', aiResponse.content);
            }
        }

        timer.step('Parse response');
        
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
                guidelineTitle: resolvedGuidelineTitle,
                guidelineContentLength: guidelineContent.length,
                suggestions,
                decisions: {}, // Will store user decisions
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'pending'
            });
            debugLog('[DEBUG] dynamicAdvice: Stored suggestions in database with sessionId:', sessionId);
        } catch (dbError) {
            console.error('[DEBUG] dynamicAdvice: Database storage error:', dbError.message);
            // Continue without failing the request
        }
        timer.step('Store session');

        // Log the AI interaction
        try {
            logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    transcript_length: transcript.length,
                    analysis_length: analysis.length,
                    guideline_id: guidelineId,
                    guideline_title: resolvedGuidelineTitle,
                    guideline_content_length: guidelineContent.length
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
            ).then(() => {
                debugLog('[DEBUG] dynamicAdvice: AI interaction logged successfully');
            }).catch((logError) => {
                console.error('[DEBUG] dynamicAdvice: Error logging AI interaction:', logError.message);
            });
        } catch (logError) {
            console.error('[DEBUG] dynamicAdvice: Error logging AI interaction:', logError.message);
        }

        debugLog('[DEBUG] dynamicAdvice: Returning response', {
            sessionId,
            suggestionsCount: suggestions.length,
            guidelineTitle: resolvedGuidelineTitle,
            guidelineFilename,
            success: true
        });

        res.json({
            success: true,
            sessionId,
            suggestions,
            guidelineId,
            guidelineTitle: resolvedGuidelineTitle,
            guidelineFilename
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

// Determine Insertion Point API endpoint - finds optimal location in clinical note for new text
app.post('/determineInsertionPoint', authenticateUser, async (req, res) => {
    // Initialize step timer for profiling
    const timer = new StepTimer('/determineInsertionPoint');
    req.stepTimer = timer;
    
    try {
        debugLog('[DEBUG] determineInsertionPoint endpoint called');
        const { suggestion, clinicalNote } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!suggestion || !suggestion.suggestedText) {
            debugLog('[DEBUG] determineInsertionPoint: Missing suggestion text');
            return res.status(400).json({ success: false, error: 'Suggestion text is required' });
        }
        
        if (!clinicalNote) {
            debugLog('[DEBUG] determineInsertionPoint: Missing clinical note');
            return res.status(400).json({ success: false, error: 'Clinical note is required' });
        }
        timer.step('Validation');

        debugLog('[DEBUG] determineInsertionPoint request data:', {
            userId,
            suggestionTextLength: suggestion.suggestedText.length,
            clinicalNoteLength: clinicalNote.length
        });

        // Create AI prompt to analyse note structure and determine insertion point
        const systemPrompt = `You are a medical AI assistant that analyses clinical note structure to identify where new information should be added.

Your task is to:
1. Analyse the structure of the clinical note and identify its sections (e.g., Situation, Issues, Background, Assessment, Discussion, Plan)
2. Identify any nested subsections within those sections (e.g., "**Counselling:**" under "Plan", "**Management Plan:**" under "Plan")
3. Determine which section or subsection the new text belongs to based on its content

Common clinical note structures to recognise:
- SOAP (Subjective, Objective, Assessment, Plan)
- SBAR (Situation, Background, Assessment, Recommendation)
- Custom sections like: Situation, Issues, Background, Assessment, Discussion, Plan
- Nested subsections often use markdown bold formatting: "* **Management Plan:**", "* **Counselling:**"

Guidelines for categorising content:
- Patient demographics, presentation details → Situation/Subjective section
- Medical history, context → Background section
- Clinical findings, risk assessments, observations → Assessment section
- Treatment discussions, considerations → Discussion section
- Management steps, follow-up plans, counselling → Plan section (or subsections within Plan like Management Plan, Counselling, etc.)

Return ONLY a valid JSON object with this structure:
{
  "section": "name of the main section where text should be inserted",
  "subsection": "name of nested subsection if applicable, otherwise null",
  "reasoning": "brief explanation of why this location is appropriate"
}

Field descriptions:
- section: Main section name (e.g., "Plan", "Assessment")
- subsection: Nested subsection name if the text belongs in one (e.g., "Counselling", "Management Plan"), otherwise null
- reasoning: Brief explanation of placement decision

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY the JSON object - no markdown code blocks, no explanatory text
- Do not wrap the JSON in \`\`\`json or \`\`\` blocks
- Start your response directly with { and end with }
- Ensure all JSON is properly formatted and valid`;

        const userPrompt = `Clinical Note:
${clinicalNote}

New Text to Insert:
${suggestion.suggestedText}

Context: ${suggestion.context || 'No additional context'}

Please analyse the clinical note structure and determine the optimal insertion point for this new text.`;

        debugLog('[DEBUG] determineInsertionPoint: Sending to AI');
        timer.step('Build prompts');

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        timer.step('AI API call');
        
        debugLog('[DEBUG] determineInsertionPoint: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] determineInsertionPoint: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Parse AI response
        let insertionPoint;
        try {
            insertionPoint = JSON.parse(aiResponse.content);
            debugLog('[DEBUG] determineInsertionPoint: Parsed insertion point:', insertionPoint);
        } catch (parseError) {
            console.error('[DEBUG] determineInsertionPoint: Failed to parse AI response:', parseError);
            console.error('[DEBUG] determineInsertionPoint: Raw AI response:', aiResponse.content);
            return res.status(500).json({ success: false, error: 'Failed to parse AI response' });
        }
        timer.step('Parse response');

        // Validate response structure
        if (!insertionPoint.section) {
            console.error('[DEBUG] determineInsertionPoint: Invalid insertion point structure:', insertionPoint);
            return res.status(500).json({ success: false, error: 'Invalid insertion point structure - missing section' });
        }
        
        // Ensure optional fields have default values
        insertionPoint.subsection = insertionPoint.subsection || null;

        res.json({
            success: true,
            insertionPoint
        });

    } catch (error) {
        console.error('[DEBUG] determineInsertionPoint: Error in endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// OPTIONS handler for getGuidelinePDF (CORS preflight)
app.options('/getGuidelinePDF', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
});

// Get Guideline PDF endpoint - serves PDF files for viewing
// OPTIONS handler for CORS preflight for /api/pdf endpoint
app.options('/api/pdf/:guidelineId', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).send();
});

// New endpoint for PDF.js viewer - serves PDF with proper headers
app.get('/api/pdf/:guidelineId', async (req, res) => {
    try {
        debugLog('[DEBUG] /api/pdf endpoint called for guideline:', req.params.guidelineId);
        debugLog('[DEBUG] /api/pdf request details:', {
            hasQueryToken: !!req.query.token,
            hasAuthHeader: !!req.headers.authorization,
            origin: req.headers.origin
        });
        
        const { guidelineId } = req.params;
        
        if (!guidelineId) {
            debugLog('[DEBUG] /api/pdf: No guideline ID provided');
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }

        // Get auth token from query parameter, header, or sessionStorage (passed via referer)
        let idToken = req.query.token || req.headers.authorization?.replace('Bearer ', '');
        
        if (!idToken) {
            debugLog('[DEBUG] api/pdf: No token provided in query or header');
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        // Verify Firebase token
        try {
            const decodedToken = await admin.auth().verifyIdToken(idToken);
            debugLog('[DEBUG] api/pdf: User authenticated:', decodedToken.uid);
        } catch (authError) {
            console.error('[DEBUG] api/pdf: Authentication failed:', authError.message);
            return res.status(401).json({ success: false, error: 'Invalid authentication token' });
        }

        debugLog('[DEBUG] api/pdf: Looking up guideline:', guidelineId);

        // Look up guideline metadata to get filename
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!guidelineDoc.exists) {
            debugLog('[DEBUG] api/pdf: Guideline not found in Firestore:', guidelineId);
            return res.status(404).json({ success: false, error: 'Guideline not found' });
        }

        const guidelineData = guidelineDoc.data();
        const filename = guidelineData.filename || guidelineData.originalFilename;
        
        debugLog('[DEBUG] api/pdf: Guideline data retrieved:', {
            guidelineId,
            hasFilename: !!guidelineData.filename,
            hasOriginalFilename: !!guidelineData.originalFilename,
            filename: filename,
            allDataKeys: Object.keys(guidelineData)
        });
        
        if (!filename) {
            console.error('[DEBUG] api/pdf: No filename found for guideline:', {
                guidelineId,
                availableFields: Object.keys(guidelineData)
            });
            return res.status(404).json({ success: false, error: 'PDF filename not found' });
        }

        debugLog('[DEBUG] api/pdf: Fetching PDF from Firebase Storage:', filename);

        // Fetch from Firebase Storage
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const file = bucket.file(`pdfs/${filename}`);
        
        const [exists] = await file.exists();
        if (!exists) {
            console.error('[DEBUG] api/pdf: PDF not found in Firebase Storage:', filename);
            console.error('[DEBUG] api/pdf: Guideline data:', {
                guidelineId,
                filename,
                hasDownloadUrl: !!guidelineData.downloadUrl,
                downloadUrl: guidelineData.downloadUrl
            });
            
            // Return detailed error with information about how to fix it
            return res.status(404).json({ 
                success: false, 
                error: 'PDF file not found in Firebase Storage',
                details: {
                    guidelineId,
                    filename,
                    expectedPath: `pdfs/${filename}`,
                    downloadUrl: guidelineData.downloadUrl,
                    message: 'This PDF needs to be uploaded to Firebase Storage. Use the /uploadMissingPdf endpoint to upload it from GitHub.'
                }
            });
        }

        debugLog('[DEBUG] api/pdf: Downloading PDF from Firebase Storage');
        const [buffer] = await file.download();
        debugLog('[DEBUG] api/pdf: PDF downloaded, size:', buffer.length, 'bytes');

        // Set appropriate headers for PDF.js viewer
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline'); // Display in browser, not download
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
        res.setHeader('Content-Length', buffer.length);
        
        // Send PDF buffer
        res.send(buffer);

    } catch (error) {
        console.error('[DEBUG] api/pdf: Error in endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Endpoint to upload missing PDF from GitHub to Firebase Storage
app.post('/uploadMissingPdf', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }

        console.log('[UPLOAD_MISSING_PDF] Starting upload for guideline:', guidelineId);

        // Look up guideline in Firestore
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!guidelineDoc.exists) {
            return res.status(404).json({ success: false, error: 'Guideline not found in Firestore' });
        }

        const guidelineData = guidelineDoc.data();
        const filename = guidelineData.filename || guidelineData.originalFilename;
        const downloadUrl = guidelineData.downloadUrl;

        if (!filename) {
            return res.status(400).json({ success: false, error: 'PDF filename not found in guideline data' });
        }

        if (!downloadUrl || !downloadUrl.includes('github.com')) {
            return res.status(400).json({ 
                success: false, 
                error: 'No GitHub download URL found for this guideline',
                downloadUrl 
            });
        }

        // Check if PDF already exists in Storage
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const storageFile = bucket.file(`pdfs/${filename}`);
        const [exists] = await storageFile.exists();
        
        if (exists) {
            console.log('[UPLOAD_MISSING_PDF] PDF already exists in Storage, skipping upload');
            return res.json({ 
                success: true, 
                message: 'PDF already exists in Firebase Storage',
                filename,
                path: `pdfs/${filename}`
            });
        }

        // Download PDF from GitHub
        console.log('[UPLOAD_MISSING_PDF] Downloading PDF from GitHub:', downloadUrl);
        const response = await axios.get(downloadUrl, {
            responseType: 'arraybuffer',
            timeout: 60000, // 60 second timeout for large files
            headers: {
                'Accept': 'application/pdf',
                'User-Agent': 'Mozilla/5.0'
            }
        });

        const pdfBuffer = Buffer.from(response.data);
        console.log('[UPLOAD_MISSING_PDF] Downloaded PDF from GitHub, size:', pdfBuffer.length, 'bytes');

        // Upload to Firebase Storage
        console.log('[UPLOAD_MISSING_PDF] Uploading PDF to Firebase Storage:', `pdfs/${filename}`);
        await storageFile.save(pdfBuffer, {
            metadata: {
                contentType: 'application/pdf',
                metadata: {
                    uploadedBy: req.user.uid,
                    uploadedAt: new Date().toISOString(),
                    originalName: filename,
                    source: 'github',
                    guidelineId: guidelineId
                }
            }
        });

        console.log('[UPLOAD_MISSING_PDF] Successfully uploaded PDF to Firebase Storage');

        res.json({
            success: true,
            message: 'PDF successfully uploaded to Firebase Storage',
            filename,
            path: `pdfs/${filename}`,
            size: pdfBuffer.length
        });

    } catch (error) {
        console.error('[UPLOAD_MISSING_PDF] Error:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// Endpoint to upload all missing PDFs from GitHub to Firebase Storage
app.post('/uploadAllMissingPdfs', authenticateUser, async (req, res) => {
    try {
        // Check if user is admin
        const isAdmin = req.user.admin || req.user.email === 'inouvel@gmail.com';
        if (!isAdmin) {
            return res.status(403).json({ error: 'Unauthorized - Admin access required' });
        }

        console.log('[UPLOAD_ALL_MISSING] Starting bulk upload of missing PDFs');

        // Get all guidelines from Firestore
        const guidelinesSnapshot = await db.collection('guidelines').get();
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        
        const results = {
            total: 0,
            alreadyExists: 0,
            uploaded: 0,
            failed: 0,
            errors: []
        };

        for (const doc of guidelinesSnapshot.docs) {
            const guidelineData = doc.data();
            const guidelineId = doc.id;
            const filename = guidelineData.filename || guidelineData.originalFilename;
            const downloadUrl = guidelineData.downloadUrl;

            if (!filename || !downloadUrl || !downloadUrl.includes('github.com')) {
                continue; // Skip guidelines without PDFs or GitHub URLs
            }

            results.total++;

            try {
                // Check if PDF already exists
                const storageFile = bucket.file(`pdfs/${filename}`);
                const [exists] = await storageFile.exists();
                
                if (exists) {
                    results.alreadyExists++;
                    console.log(`[UPLOAD_ALL_MISSING] Skipping ${filename} - already exists`);
                    continue;
                }

                // Download from GitHub
                console.log(`[UPLOAD_ALL_MISSING] Uploading ${filename}...`);
                const response = await axios.get(downloadUrl, {
                    responseType: 'arraybuffer',
                    timeout: 60000,
                    headers: {
                        'Accept': 'application/pdf',
                        'User-Agent': 'Mozilla/5.0'
                    }
                });

                const pdfBuffer = Buffer.from(response.data);

                // Upload to Storage
                await storageFile.save(pdfBuffer, {
                    metadata: {
                        contentType: 'application/pdf',
                        metadata: {
                            uploadedBy: req.user.uid,
                            uploadedAt: new Date().toISOString(),
                            originalName: filename,
                            source: 'github',
                            guidelineId: guidelineId
                        }
                    }
                });

                results.uploaded++;
                console.log(`[UPLOAD_ALL_MISSING] Successfully uploaded ${filename}`);

            } catch (error) {
                results.failed++;
                results.errors.push({
                    guidelineId,
                    filename,
                    error: error.message
                });
                console.error(`[UPLOAD_ALL_MISSING] Failed to upload ${filename}:`, error.message);
            }
        }

        res.json({
            success: true,
            message: 'Bulk upload completed',
            results
        });

    } catch (error) {
        console.error('[UPLOAD_ALL_MISSING] Error:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

app.get('/getGuidelinePDF', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.query;
        
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }

        debugLog('[DEBUG] getGuidelinePDF: Looking up guideline:', guidelineId);

        // Look up guideline metadata to get filename
        const guidelineDoc = await db.collection('guidelines').doc(guidelineId).get();
        
        if (!guidelineDoc.exists) {
            debugLog('[DEBUG] getGuidelinePDF: Guideline not found:', guidelineId);
            return res.status(404).json({ success: false, error: 'Guideline not found' });
        }

        const guidelineData = guidelineDoc.data();
        const filename = guidelineData.filename || guidelineData.originalFilename;
        
        if (!filename) {
            debugLog('[DEBUG] getGuidelinePDF: No filename found for guideline:', guidelineId);
            return res.status(404).json({ success: false, error: 'PDF filename not found' });
        }

        debugLog('[DEBUG] getGuidelinePDF: Fetching PDF from Firebase Storage:', filename);

        // Fetch from Firebase Storage
        const bucket = admin.storage().bucket('clerky-b3be8.firebasestorage.app');
        const file = bucket.file(`pdfs/${filename}`);
        
        const [exists] = await file.exists();
        if (!exists) {
            debugLog('[DEBUG] getGuidelinePDF: PDF not found in Firebase Storage:', filename);
            return res.status(404).json({ success: false, error: 'PDF file not found in storage' });
        }

        debugLog('[DEBUG] getGuidelinePDF: Downloading PDF from Firebase Storage');
        const [buffer] = await file.download();
        debugLog('[DEBUG] getGuidelinePDF: PDF downloaded, size:', buffer.length, 'bytes');

        // Set appropriate headers for PDF and CORS
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Type');
        res.setHeader('Content-Length', buffer.length);
        
        // Send PDF buffer
        res.send(buffer);

    } catch (error) {
        console.error('[DEBUG] getGuidelinePDF: Error in endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Incorporate Suggestion endpoint - intelligently adds suggestion to section content
app.post('/incorporateSuggestion', authenticateUser, async (req, res) => {
    // Initialize step timer for profiling
    const timer = new StepTimer('/incorporateSuggestion');
    req.stepTimer = timer;
    
    try {
        debugLog('[DEBUG] incorporateSuggestion endpoint called');
        const { sectionName, subsectionName, currentSectionContent, suggestionText, originalText } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!sectionName) {
            debugLog('[DEBUG] incorporateSuggestion: Missing section name');
            return res.status(400).json({ success: false, error: 'Section name is required' });
        }
        
        if (!currentSectionContent) {
            debugLog('[DEBUG] incorporateSuggestion: Missing section content');
            return res.status(400).json({ success: false, error: 'Section content is required' });
        }
        
        if (!suggestionText) {
            debugLog('[DEBUG] incorporateSuggestion: Missing suggestion text');
            return res.status(400).json({ success: false, error: 'Suggestion text is required' });
        }
        timer.step('Validation');

        debugLog('[DEBUG] incorporateSuggestion request data:', {
            userId,
            sectionName,
            subsectionName: subsectionName || 'none',
            sectionContentLength: currentSectionContent.length,
            suggestionTextLength: suggestionText.length,
            originalTextLength: originalText ? originalText.length : 0
        });

        // Create AI prompt to incorporate suggestion into section
        const targetDescription = subsectionName 
            ? `the "${subsectionName}" subsection within the "${sectionName}" section`
            : `the "${sectionName}" section`;
        
        const hasOriginalText = !!originalText;

        const systemPrompt = `You are a medical AI assistant that helps incorporate new information into clinical notes while preserving existing formatting.

Your task is to:
1. Analyse the current ${targetDescription} content and understand its structure and formatting
2. Determine the most appropriate location to add the new suggestion text
3. Insert the suggestion text VERBATIM (word-for-word, exactly as provided) into the appropriate location
4. Preserve all existing formatting (numbered lists, bullet points, plain text, indentation, etc.)
5. Return the complete modified section with the suggestion incorporated

CRITICAL RULES:
- You MUST insert the suggestion text EXACTLY as provided - do not rephrase, reword, or modify it
- If the section has numbered items, add the suggestion as the next numbered item
- If the section has bullet points, add the suggestion as another bullet point
- If the section has plain text lines, add the suggestion as another plain text line
- Preserve the exact formatting style of existing items
- NEVER add blank lines between the existing content and the new suggestion - add new items immediately after existing items with only a single line break
- Do not add extra blank lines between items - items should follow each other with single line breaks only
- Match the indentation and spacing of existing items exactly
- The modifiedSectionContent must NOT start or end with blank lines
${
    hasOriginalText
        ? `

SPECIAL RULES WHEN ORIGINAL REFERENCE TEXT IS PROVIDED:
- You may also be given an "original reference text" from the same section.
- First, look for a sentence, bullet point, or line in the current section that closely matches this original reference text (it may not be exactly identical – minor wording or punctuation differences are allowed).
- If you find such a match, UPDATE or REPLACE that matched sentence/bullet so that it now expresses the suggestion text verbatim, instead of simply adding a separate new line.
- Only if no reasonably close match exists should you add the suggestion text as a new item at the most appropriate location.`
        : ''
}

Return ONLY a valid JSON object with this structure:
{
  "modifiedSectionContent": "the complete section content with suggestion incorporated",
  "insertionLocation": "brief description of where the suggestion was added (e.g., 'Added as 6th item in numbered list', 'Added as last bullet point', 'Appended to end of section')"
}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY the JSON object - no markdown code blocks, no explanatory text
- Do not wrap the JSON in \`\`\`json or \`\`\` blocks
- Start your response directly with { and end with }
- Ensure all JSON is properly formatted and valid
- Ensure the suggestion text appears verbatim in the output`;

        let userPrompt = `Current ${targetDescription} content:
${currentSectionContent}

Suggestion text to incorporate (VERBATIM):
${suggestionText}
`;

        if (hasOriginalText) {
            userPrompt += `

Original reference text (if present in the section, update this content instead of adding a separate new line):
${originalText}
`;
        }

        userPrompt += `

Please incorporate this suggestion into the section content, preserving existing formatting and inserting the suggestion text exactly as provided.`;

        debugLog('[DEBUG] incorporateSuggestion: Sending to AI');
        timer.step('Build prompts');

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        timer.step('AI API call');
        
        debugLog('[DEBUG] incorporateSuggestion: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] incorporateSuggestion: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // Parse AI response
        let result;
        try {
            result = JSON.parse(aiResponse.content);
            debugLog('[DEBUG] incorporateSuggestion: Parsed result:', {
                hasModifiedContent: !!result.modifiedSectionContent,
                insertionLocation: result.insertionLocation
            });
        } catch (parseError) {
            console.error('[DEBUG] incorporateSuggestion: Failed to parse AI response:', parseError);
            console.error('[DEBUG] incorporateSuggestion: Raw AI response:', aiResponse.content);
            return res.status(500).json({ success: false, error: 'Failed to parse AI response' });
        }

        timer.step('Parse response');
        
        // Validate response structure
        if (!result.modifiedSectionContent) {
            console.error('[DEBUG] incorporateSuggestion: Invalid result structure:', result);
            return res.status(500).json({ success: false, error: 'Invalid result structure' });
        }

        res.json({
            success: true,
            modifiedSectionContent: result.modifiedSectionContent,
            insertionLocation: result.insertionLocation || 'Unknown'
        });

    } catch (error) {
        console.error('[DEBUG] incorporateSuggestion: Error in endpoint:', {
            error: error.message,
            stack: error.stack
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// Multi-Guideline Dynamic Advice API endpoint - processes multiple guidelines and combines suggestions
app.post('/multiGuidelineDynamicAdvice', authenticateUser, async (req, res) => {
    try {
        debugLog('[DEBUG] multiGuidelineDynamicAdvice endpoint called');
        const { transcript, guidelineAnalyses } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!transcript) {
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Missing transcript');
            return res.status(400).json({ success: false, error: 'Transcript is required' });
        }
        
        if (!guidelineAnalyses || !Array.isArray(guidelineAnalyses) || guidelineAnalyses.length === 0) {
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Missing or invalid guideline analyses');
            return res.status(400).json({ success: false, error: 'Guideline analyses array is required' });
        }

        debugLog('[DEBUG] multiGuidelineDynamicAdvice request data:', {
            userId,
            transcriptLength: transcript.length,
            guidelinesCount: guidelineAnalyses.length,
            guidelines: guidelineAnalyses.map(g => ({ id: g.guidelineId, title: g.guidelineTitle }))
        });

        // Fetch feedback summaries for all guidelines
        const guidelineFeedbackMap = {};
        for (const analysis of guidelineAnalyses) {
            if (analysis.guidelineId) {
                try {
                    const guidelineDoc = await db.collection('guidelines').doc(analysis.guidelineId).get();
                    if (guidelineDoc.exists) {
                        const guidelineData = guidelineDoc.data();
                        
                        // Check if feedback summary is available and recent
                        if (guidelineData.feedbackSummary && guidelineData.feedbackLastSummarised) {
                            const summaryDate = guidelineData.feedbackLastSummarised.toDate ? 
                                guidelineData.feedbackLastSummarised.toDate() : new Date(guidelineData.feedbackLastSummarised);
                            const daysSinceSummary = (Date.now() - summaryDate.getTime()) / (1000 * 60 * 60 * 24);
                            
                            if (daysSinceSummary <= 30) {
                                guidelineFeedbackMap[analysis.guidelineId] = {
                                    title: analysis.guidelineTitle || analysis.guidelineId,
                                    summary: guidelineData.feedbackSummary,
                                    entriesCount: guidelineData.feedbackSummarisedCount || 0
                                };
                                console.log(`[DEBUG] multiGuidelineDynamicAdvice: Found feedback for ${analysis.guidelineId}`);
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[DEBUG] multiGuidelineDynamicAdvice: Error fetching feedback for ${analysis.guidelineId}:`, error.message);
                }
            }
        }

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

LEARNED CLINICAL PATTERNS:
When available, you will be provided with aggregated feedback from experienced clinicians about these guidelines' application. This feedback represents real-world clinical wisdom about when certain recommendations may not be appropriate. Consider these patterns alongside the guideline text when making suggestions.

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

        // Prepare feedback summaries text if available
        let feedbackSummariesText = '';
        const feedbackGuidelineIds = Object.keys(guidelineFeedbackMap);
        if (feedbackGuidelineIds.length > 0) {
            feedbackSummariesText = '\n\nCLINICAL FEEDBACK FROM PREVIOUS USERS:\n';
            feedbackSummariesText += 'The following patterns have been identified from clinician feedback on these guidelines:\n\n';
            feedbackGuidelineIds.forEach(guidelineId => {
                const feedback = guidelineFeedbackMap[guidelineId];
                feedbackSummariesText += `--- ${feedback.title} (based on ${feedback.entriesCount} feedback entries) ---\n`;
                feedbackSummariesText += `${feedback.summary}\n\n`;
            });
            feedbackSummariesText += 'Please consider this feedback when determining if suggestions are appropriate for this specific case.\n';
        }

        const userPrompt = `Original Transcript:
${transcript}

Combined Guideline Analyses:
${combinedAnalysesText}
${feedbackSummariesText}

Please extract and consolidate actionable suggestions from these multiple guideline analyses. Create combined suggestions when multiple guidelines recommend similar interventions, and prioritize suggestions based on clinical importance and consensus across guidelines. For each suggestion, include detailed context with relevant quoted text from the supporting guidelines.`;

        debugLog('[DEBUG] multiGuidelineDynamicAdvice: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            guidelinesCount: guidelineAnalyses.length
        });

        // Send to AI with retry logic for context length exceeded
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        let aiResponse;
        let usedFallback = false;
        
        try {
            aiResponse = await routeToAI({ messages }, userId);
        } catch (aiError) {
            // Check if error is due to context length exceeded
            const isContextLengthError = aiError.message && (
                aiError.message.includes('maximum context length') ||
                aiError.message.includes('context_length_exceeded') ||
                aiError.message.includes('too many tokens')
            );
            
            if (isContextLengthError) {
                debugLog('[DEBUG] multiGuidelineDynamicAdvice: Context length exceeded, attempting fallback with truncated analyses');
                
                // Truncate each analysis to reduce total size
                const MAX_ANALYSIS_LENGTH_PER_GUIDELINE = 5000;
                let truncatedAnalysesText = '';
                guidelineAnalyses.forEach((analysis, index) => {
                    truncatedAnalysesText += `\n\n=== GUIDELINE ${index + 1}: ${analysis.guidelineTitle || analysis.guidelineId} ===\n`;
                    const analysisText = analysis.analysis || '';
                    if (analysisText.length > MAX_ANALYSIS_LENGTH_PER_GUIDELINE) {
                        truncatedAnalysesText += analysisText.substring(0, MAX_ANALYSIS_LENGTH_PER_GUIDELINE) + '\n...[Analysis truncated]...';
                    } else {
                        truncatedAnalysesText += analysisText;
                    }
                });
                
                const fallbackUserPrompt = `Original Transcript:
${transcript}

Combined Guideline Analyses (condensed):
${truncatedAnalysesText}
${feedbackSummariesText}

Please extract and consolidate actionable suggestions from these multiple guideline analyses. Create combined suggestions when multiple guidelines recommend similar interventions, and prioritize suggestions based on clinical importance and consensus across guidelines. For each suggestion, include detailed context with relevant quoted text from the supporting guidelines.`;

                messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: fallbackUserPrompt }
                ];
                
                debugLog('[DEBUG] multiGuidelineDynamicAdvice: Retrying with truncated analyses', {
                    fallbackUserPromptLength: fallbackUserPrompt.length,
                    originalUserPromptLength: userPrompt.length
                });
                
                aiResponse = await routeToAI({ messages }, userId);
                usedFallback = true;
            } else {
                // Re-throw if not a context length error
                throw aiError;
            }
        }
        
        if (usedFallback) {
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Successfully completed with fallback truncated content');
        }
        
        debugLog('[DEBUG] multiGuidelineDynamicAdvice: AI response received', {
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
            
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Parsed suggestions directly:', {
                suggestionsCount: combinedSuggestions.length,
                guidelinesSummaryCount: guidelinesSummary.length
            });
        } catch (parseError) {
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Direct JSON parse failed, trying to extract from markdown:', {
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
                    debugLog('[DEBUG] multiGuidelineDynamicAdvice: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        debugLog('[DEBUG] multiGuidelineDynamicAdvice: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                debugLog('[DEBUG] multiGuidelineDynamicAdvice: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                const parsedResponse = JSON.parse(jsonContent);
                combinedSuggestions = parsedResponse.combinedSuggestions || [];
                guidelinesSummary = parsedResponse.guidelinesSummary || [];
                
                debugLog('[DEBUG] multiGuidelineDynamicAdvice: Successfully parsed extracted JSON:', {
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
                
                debugLog('[DEBUG] multiGuidelineDynamicAdvice: Using final fallback suggestion format');
                
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
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: Stored combined suggestions in database with sessionId:', sessionId);
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
            debugLog('[DEBUG] multiGuidelineDynamicAdvice: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] multiGuidelineDynamicAdvice: Error logging AI interaction:', logError.message);
        }

        debugLog('[DEBUG] multiGuidelineDynamicAdvice: Returning response', {
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
        debugLog('[DEBUG] applyDynamicAdvice endpoint called');
        const { sessionId, decisions } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!sessionId) {
            debugLog('[DEBUG] applyDynamicAdvice: Missing sessionId');
            return res.status(400).json({ success: false, error: 'Session ID is required' });
        }
        
        if (!decisions || typeof decisions !== 'object') {
            debugLog('[DEBUG] applyDynamicAdvice: Invalid decisions format');
            return res.status(400).json({ success: false, error: 'Decisions object is required' });
        }

        debugLog('[DEBUG] applyDynamicAdvice request data:', {
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
                debugLog('[DEBUG] applyDynamicAdvice: Session not found in database:', sessionId);
                return res.status(404).json({ success: false, error: 'Session not found' });
            }
            
            storedData = doc.data();
            
            if (storedData.userId !== userId) {
                debugLog('[DEBUG] applyDynamicAdvice: User mismatch', {
                    storedUserId: storedData.userId,
                    requestUserId: userId
                });
                return res.status(403).json({ success: false, error: 'Unauthorized access to session' });
            }
            
            debugLog('[DEBUG] applyDynamicAdvice: Retrieved stored data', {
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
                debugLog('[DEBUG] applyDynamicAdvice: No decision for suggestion:', suggestion.id);
                return;
            }

            debugLog('[DEBUG] applyDynamicAdvice: Processing decision', {
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
                    debugLog('[DEBUG] applyDynamicAdvice: Unknown action:', decision.action);
            }
        });

        debugLog('[DEBUG] applyDynamicAdvice: Decision summary', {
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

        debugLog('[DEBUG] applyDynamicAdvice: Sending to AI', {
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
        
        debugLog('[DEBUG] applyDynamicAdvice: AI response received', {
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
            debugLog('[DEBUG] applyDynamicAdvice: Updated database with final results');
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
            debugLog('[DEBUG] applyDynamicAdvice: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] applyDynamicAdvice: Error logging AI interaction:', logError.message);
        }

        debugLog('[DEBUG] applyDynamicAdvice: Returning response', {
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

// ========================================
// GUIDELINE FEEDBACK LEARNING SYSTEM
// ========================================

// Submit feedback for guideline suggestions
app.post('/submitGuidelineFeedback', authenticateUser, async (req, res) => {
    try {
        console.log('[FEEDBACK] submitGuidelineFeedback endpoint called');
        const { guidelineId, sessionId, feedbackEntries, transcript } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!guidelineId) {
            console.log('[FEEDBACK] Missing guidelineId');
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }
        
        if (!feedbackEntries || !Array.isArray(feedbackEntries) || feedbackEntries.length === 0) {
            console.log('[FEEDBACK] No feedback entries provided');
            return res.status(200).json({ 
                success: true, 
                message: 'No feedback to submit',
                feedbackCount: 0 
            });
        }
        
        console.log('[FEEDBACK] Processing feedback:', {
            guidelineId,
            sessionId,
            userId,
            feedbackCount: feedbackEntries.length
        });
        
        // Validate guideline exists
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            console.log('[FEEDBACK] Guideline not found:', guidelineId);
            return res.status(404).json({ 
                success: false, 
                error: `Guideline not found: ${guidelineId}` 
            });
        }
        
        // Prepare feedback entries with metadata
        const timestampedEntries = feedbackEntries.map(entry => ({
            userId,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            sessionId: sessionId || 'unknown',
            suggestionId: entry.suggestionId,
            action: entry.action, // 'reject' or 'modify'
            rejectionReason: entry.rejectionReason || '',
            clinicalScenario: entry.clinicalScenario || (transcript ? transcript.substring(0, 500) : ''),
            modifiedText: entry.modifiedText || null,
            originalSuggestion: entry.originalSuggestion || '',
            suggestedText: entry.suggestedText || ''
        }));
        
        // Update guideline document with feedback
        const currentData = guidelineDoc.data();
        const existingFeedback = currentData.feedbackEntries || [];
        const existingCount = currentData.feedbackCount || 0;
        
        await guidelineRef.update({
            feedbackEntries: admin.firestore.FieldValue.arrayUnion(...timestampedEntries),
            feedbackCount: existingCount + timestampedEntries.length,
            lastFeedbackReceived: admin.firestore.FieldValue.serverTimestamp()
        });
        
        console.log('[FEEDBACK] Successfully stored feedback entries:', {
            guidelineId,
            newEntries: timestampedEntries.length,
            totalFeedback: existingCount + timestampedEntries.length
        });
        
        // Trigger async summarisation (don't wait for it to complete)
        // Only trigger if we have accumulated enough feedback (e.g., every 5 entries)
        const newTotalCount = existingCount + timestampedEntries.length;
        const shouldSummarise = newTotalCount >= 5 && (newTotalCount % 5 === 0 || newTotalCount === 5);
        
        if (shouldSummarise) {
            console.log('[FEEDBACK] Triggering async summarisation for:', guidelineId);
            // Fire and forget - don't await
            summariseGuidelineFeedback(guidelineId).catch(error => {
                console.error('[FEEDBACK] Background summarisation error:', error.message);
            });
        }
        
        res.json({ 
            success: true, 
            message: 'Feedback submitted successfully',
            feedbackCount: timestampedEntries.length,
            totalFeedback: newTotalCount
        });
        
    } catch (error) {
        console.error('[FEEDBACK] Error submitting feedback:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to submit feedback',
            details: error.message 
        });
    }
});

// Summarise guideline feedback using AI (background async function)
async function summariseGuidelineFeedback(guidelineId) {
    try {
        console.log('[FEEDBACK_SUMMARY] Starting summarisation for:', guidelineId);
        
        // Fetch guideline and all its feedback
        const guidelineRef = db.collection('guidelines').doc(guidelineId);
        const guidelineDoc = await guidelineRef.get();
        
        if (!guidelineDoc.exists) {
            throw new Error(`Guideline not found: ${guidelineId}`);
        }
        
        const guidelineData = guidelineDoc.data();
        const feedbackEntries = guidelineData.feedbackEntries || [];
        
        if (feedbackEntries.length === 0) {
            console.log('[FEEDBACK_SUMMARY] No feedback entries to summarise');
            return;
        }
        
        console.log('[FEEDBACK_SUMMARY] Processing', feedbackEntries.length, 'feedback entries');
        
        // Filter to only feedback with actual reasons provided
        const meaningfulFeedback = feedbackEntries.filter(entry => 
            entry.rejectionReason && entry.rejectionReason.trim().length > 10
        );
        
        if (meaningfulFeedback.length === 0) {
            console.log('[FEEDBACK_SUMMARY] No meaningful feedback to summarise');
            return;
        }
        
        // Prepare feedback for AI analysis
        const feedbackText = meaningfulFeedback.map((entry, index) => {
            const timestamp = entry.timestamp?.toDate?.() || new Date();
            return `
Feedback ${index + 1} (${timestamp.toISOString().split('T')[0]}):
Action: ${entry.action}
Clinical Scenario: ${entry.clinicalScenario}
Reason: ${entry.rejectionReason}
Original Suggestion: ${entry.originalSuggestion || 'N/A'}
${entry.modifiedText ? `Modified To: ${entry.modifiedText}` : ''}
---`;
        }).join('\n');
        
        // Create AI prompt for summarisation
        const systemPrompt = `You are a medical AI assistant analysing clinician feedback on guideline application.

Your task is to identify common patterns, concerns, and insights from clinician feedback about a specific clinical guideline's suggestions.

Analyse the feedback and produce a concise summary (200-300 words) that:
1. Identifies recurring themes or patterns in rejections/modifications
2. Notes specific clinical scenarios where the guideline may not be appropriate
3. Highlights timing, context, or applicability concerns
4. Provides actionable insights for future suggestion generation

Be specific and clinical in your analysis. Focus on patterns, not individual cases.`;

        const userPrompt = `Guideline: ${guidelineData.humanFriendlyTitle || guidelineData.title || guidelineId}

Clinician Feedback:
${feedbackText}

Please analyse this feedback and provide a concise summary of common patterns and insights that should inform future application of this guideline.`;

        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];
        
        // Call AI to generate summary
        console.log('[FEEDBACK_SUMMARY] Calling AI for summarisation');
        const aiResponse = await routeToAI({ messages }, 'system'); // Use system as userId for background tasks
        
        if (!aiResponse || !aiResponse.content) {
            throw new Error('AI summarisation failed - no content returned');
        }
        
        const feedbackSummary = aiResponse.content.trim();
        
        console.log('[FEEDBACK_SUMMARY] AI summary generated, length:', feedbackSummary.length);
        
        // Update guideline with summary
        await guidelineRef.update({
            feedbackSummary: feedbackSummary,
            feedbackLastSummarised: admin.firestore.FieldValue.serverTimestamp(),
            feedbackSummarisedCount: meaningfulFeedback.length
        });
        
        console.log('[FEEDBACK_SUMMARY] Successfully updated guideline with feedback summary');
        
        return {
            success: true,
            guidelineId,
            feedbackCount: meaningfulFeedback.length,
            summaryLength: feedbackSummary.length
        };
        
    } catch (error) {
        console.error('[FEEDBACK_SUMMARY] Error:', error);
        throw error;
    }
}

// Manual endpoint to trigger feedback summarisation (for testing/admin use)
app.post('/summariseGuidelineFeedback', authenticateUser, async (req, res) => {
    try {
        const { guidelineId } = req.body;
        
        if (!guidelineId) {
            return res.status(400).json({ success: false, error: 'Guideline ID is required' });
        }
        
        console.log('[FEEDBACK_SUMMARY] Manual summarisation requested for:', guidelineId);
        
        const result = await summariseGuidelineFeedback(guidelineId);
        
        res.json({ 
            success: true, 
            message: 'Feedback summarised successfully',
            result 
        });
        
    } catch (error) {
        console.error('[FEEDBACK_SUMMARY] Manual summarisation error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to summarise feedback',
            details: error.message 
        });
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
    // Generate a unique trace ID for this request to correlate all logs
    const traceId = `AGQ-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
    
    try {
        console.log(`[ASK_GUIDELINES][${traceId}] === REQUEST START ===`);
        const { question, relevantGuidelines } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!question) {
            console.log(`[ASK_GUIDELINES][${traceId}] Validation failed: Missing question`);
            return res.status(400).json({ success: false, error: 'Question is required', traceId });
        }
        
        if (!relevantGuidelines || !Array.isArray(relevantGuidelines) || relevantGuidelines.length === 0) {
            console.log(`[ASK_GUIDELINES][${traceId}] Validation failed: Missing or invalid relevant guidelines`);
            return res.status(400).json({ success: false, error: 'Relevant guidelines array is required', traceId });
        }

        console.log(`[ASK_GUIDELINES][${traceId}] Request received:`, {
            userId: userId.substring(0, 8) + '...',
            questionLength: question.length,
            questionPreview: question.substring(0, 100) + (question.length > 100 ? '...' : ''),
            guidelinesCount: relevantGuidelines.length,
            guidelineIds: relevantGuidelines.map(g => g.id)
        });

        // Fetch full guideline content for each relevant guideline
        const guidelinesWithContent = [];
        for (const guideline of relevantGuidelines) {
            try {
                console.log(`[DEBUG] askGuidelinesQuestion: Fetching content for guideline: ${guideline.id}`);
                const fullGuideline = await getGuideline(guideline.id);
                if (fullGuideline) {
                    // Merge client-provided guideline info with full Firestore document,
                    // preferring the Firestore data for all content fields so we have
                    // access to semanticallyCompressed, condensed, summary, etc.
                    guidelinesWithContent.push({
                        ...guideline,
                        ...fullGuideline
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

        debugLog('[DEBUG] askGuidelinesQuestion: Retrieved guidelines with content:', {
            count: guidelinesWithContent.length,
            withContent: guidelinesWithContent.filter(g => g.content || g.condensed || g.semanticallyCompressed).length,
            withCompressed: guidelinesWithContent.filter(g => g.semanticallyCompressed).length
        });

        // Create system prompt for answering questions based on guidelines
        // SIMPLIFIED PROMPT: AI just answers and tags each piece of advice with a GuidelineID
        // We'll find verbatim quotes in a separate step
        const systemPrompt = `You are a medical AI assistant that answers clinical questions based on relevant medical guidelines.

RESPONSE FORMAT:
Your answer MUST follow this exact structure:

### [Title of Answer]

[One paragraph summary providing an overview of the key points]

**Detailed Advice:**

[Provide detailed, specific advice. For EACH piece of clinical advice, tag it with the guideline it came from using this format: [GuidelineID: xxx] where xxx is the exact ID from the [GuidelineID: ...] field provided with each guideline.]

You may use bullet points, numbered lists, or prose paragraphs - whatever best suits the answer. But EVERY piece of specific clinical advice MUST have a [GuidelineID: xxx] tag immediately after it.

IMPORTANT RULES:
1. Use the EXACT GuidelineID from the [GuidelineID: ...] field - do NOT use the guideline title
2. Tag each specific recommendation, threshold, timing, or clinical action
3. If multiple guidelines support the same advice, you may list multiple tags
4. Use clear, professional medical language
5. If guidelines don't fully address the question, acknowledge this

EXAMPLE FORMAT:
### Managing Postpartum Haemorrhage

PPH is defined as blood loss >500ml after vaginal delivery or >1000ml after caesarean section. Prompt recognition and treatment are essential for maternal safety.

**Detailed Advice:**

- Administer oxytocin 10 IU IV immediately after delivery of the placenta [GuidelineID: mp046-pph-guideline]
- Estimate blood loss using visual aids and weighing of swabs [GuidelineID: cg12029-pph-management]
- If blood loss exceeds 1500ml, activate the major obstetric haemorrhage protocol [GuidelineID: mp046-pph-guideline]

Always base your answers on the provided guidelines.`;

        // Build a fast lookup of guideline text for quote finding
        // CRITICAL: ONLY use raw content (g.content) for quote verification
        // The condensed/semanticallyCompressed text has been reformatted and won't match the PDF
        const guidelineTextById = {};
        const guidelinesWithMissingContent = [];
        
        for (const g of guidelinesWithContent) {
            if (g.content && String(g.content).trim()) {
                guidelineTextById[g.id] = String(g.content).trim();
            } else {
                // LOG ERROR - guideline is missing content, this needs to be fixed
                guidelinesWithMissingContent.push({
                    id: g.id,
                    title: g.title,
                    hasCondensed: !!(g.condensed && String(g.condensed).trim()),
                    hasSemanticallyCompressed: !!(g.semanticallyCompressed && String(g.semanticallyCompressed).trim())
                });
                guidelineTextById[g.id] = ''; // Empty - will trigger fallback search
            }
        }
        
        // Log error for guidelines missing content - these need data fixes
        if (guidelinesWithMissingContent.length > 0) {
            console.error(`[ASK_GUIDELINES][${traceId}] ⚠️ CRITICAL: ${guidelinesWithMissingContent.length} guidelines are MISSING raw content!`);
            console.error(`[ASK_GUIDELINES][${traceId}] These guidelines cannot have accurate PDF search. Data needs fixing:`);
            for (const g of guidelinesWithMissingContent) {
                console.error(`[ASK_GUIDELINES][${traceId}]   - ID: ${g.id}`);
                console.error(`[ASK_GUIDELINES][${traceId}]     Title: ${g.title}`);
                console.error(`[ASK_GUIDELINES][${traceId}]     Has condensed: ${g.hasCondensed}, Has semanticallyCompressed: ${g.hasSemanticallyCompressed}`);
            }
        }

        // Create user prompt with question and guidelines
        const guidelinesText = guidelinesWithContent.map(guideline => {
            // Include the guideline ID explicitly so the AI can tag advice with it
            let guidelineText = `**${guideline.title || guideline.id}**`;
            guidelineText += `\n[GuidelineID: ${guideline.id}]`;  // AI will use this in [GuidelineID: xxx] tags
            if (guideline.organisation) {
                guidelineText += ` (${guideline.organisation})`;
            }
            if (guideline.summary) {
                guidelineText += `\nSummary: ${guideline.summary}`;
            }

            // Prefer semantically compressed text, then condensed, then full content
            let contentToUse = null;
            if (guideline.semanticallyCompressed && String(guideline.semanticallyCompressed).trim()) {
                contentToUse = String(guideline.semanticallyCompressed).trim();
            } else if (guideline.condensed && String(guideline.condensed).trim()) {
                contentToUse = String(guideline.condensed).trim();
            } else if (guideline.content) {
                // Truncate raw content to prevent context window overflow (approx 20k chars per guideline)
                const MAX_CONTENT_LENGTH = 20000;
                let content = String(guideline.content);
                if (content.length > MAX_CONTENT_LENGTH) {
                    content = content.substring(0, MAX_CONTENT_LENGTH) + '\n...[Content truncated]...';
                }
                contentToUse = content;
            }

            if (contentToUse) {
                guidelineText += `\nContent: ${contentToUse}`;
            }

            return guidelineText;
        }).join('\n\n');

        const userPrompt = `**Question:** ${question}

**Guidelines (${guidelinesWithContent.length} total):**
${guidelinesText}

Please answer this question using the guidelines above. Remember to tag each piece of specific advice with the GuidelineID it came from.`;

        debugLog('[DEBUG] askGuidelinesQuestion: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
            guidelinesCount: guidelinesWithContent.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        let aiResponse = await routeToAI({ messages }, userId);
        
        debugLog('[DEBUG] askGuidelinesQuestion: AI response received', {
            success: !!aiResponse,
            hasContent: !!aiResponse?.content,
            contentLength: aiResponse?.content?.length,
            aiProvider: aiResponse?.ai_provider
        });
        
        if (!aiResponse || !aiResponse.content) {
            console.error('[DEBUG] askGuidelinesQuestion: Invalid AI response:', aiResponse);
            return res.status(500).json({ success: false, error: 'Invalid AI response' });
        }

        // STEP 2: SIMPLIFIED CITATION PIPELINE
        // Parse [GuidelineID: xxx] tags from the AI response, find verbatim quotes
        // for each piece of advice, and replace tags with links.
        
        let enhancedAnswer = aiResponse.content;
        
        // Parse all [GuidelineID: xxx] tags and the advice text before each
        const guidelineTagRegex = /\[GuidelineID:\s*([^\]]+)\]/g;
        const citationTasks = [];
        const seenTags = new Set();
        
        let tagMatch;
        while ((tagMatch = guidelineTagRegex.exec(enhancedAnswer)) !== null) {
            const guidelineId = tagMatch[1].trim();
            const tagPosition = tagMatch.index;
            const fullMatch = tagMatch[0];
            
            // Extract the advice text before this tag (look back up to 500 chars)
            const textBefore = enhancedAnswer.substring(Math.max(0, tagPosition - 500), tagPosition);
            
            // Find the advice text using multiple strategies
            let adviceText = '';
            
            // Strategy 1: Look for bullet point or numbered list start
            // Use a more permissive regex that captures everything after the bullet marker
            const bulletMatch = textBefore.match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*([\s\S]+)$/);
            if (bulletMatch) {
                adviceText = bulletMatch[1].trim();
            }
            
            // Strategy 2: If no bullet, look for the last sentence (ending in period before the tag)
            if (!adviceText) {
                // Find the last complete sentence or fragment
                const lastLine = textBefore.split('\n').pop() || '';
                adviceText = lastLine.trim();
            }
            
            // Strategy 3: If still no text, use the last 200 chars
            if (!adviceText || adviceText.length < 10) {
                adviceText = textBefore.trim().slice(-200);
            }
            
            // Clean up the advice text (remove markdown formatting)
            adviceText = adviceText
                .replace(/\*\*/g, '')  // Remove bold markers
                .replace(/\*/g, '')     // Remove italic markers
                .replace(/`/g, '')      // Remove code markers
                .trim();
            
            // Strip common section headers that the AI adds but won't be in the PDF
            // These headers confuse the PDF search when used as fallback
            const headerPatterns = [
                /^Detailed Advice:\s*/i,
                /^Key Recommendations:\s*/i,
                /^Important:\s*/i,
                /^Note:\s*/i,
                /^Summary:\s*/i,
                /^For [^:]+:\s*/i,  // "For fetal neuroprotection:", "For eclampsia:", etc.
                /^Treatment [^:]+:\s*/i,  // "Treatment of Eclampsia:", etc.
                /^Management [^:]+:\s*/i,  // "Management of Recurrent Seizures:", etc.
                /^Emergency [^:]+:\s*/i,  // "Emergency Treatment Eclampsia:", etc.
            ];
            for (const pattern of headerPatterns) {
                adviceText = adviceText.replace(pattern, '');
            }
            adviceText = adviceText.trim();
            
            // Always add the task if we have a valid guideline ID
            // (we'll create a link even if advice text extraction wasn't perfect)
            const taskKey = `${guidelineId}|${tagPosition}`;
            if (!seenTags.has(taskKey)) {
                seenTags.add(taskKey);
                citationTasks.push({
                    guidelineId,
                    adviceText: adviceText.length >= 10 ? adviceText : '',
                    originalTag: fullMatch,
                    tagPosition
                });
            }
        }
        
        console.log(`[${traceId}] Parsed GuidelineID tags`, {
            totalTags: [...enhancedAnswer.matchAll(/\[GuidelineID:/g)].length,
            uniqueTasks: citationTasks.length,
            guidelines: citationTasks.map(t => t.guidelineId)
        });

        // STEP 3: For each citation task, find a verbatim quote from the guideline
        // Increased limit to handle longer answers with many citations
        const MAX_CITATION_QUOTES = 20;
        let quotesResolved = 0;
        const citationResults = [];

        for (const task of citationTasks) {
            if (quotesResolved >= MAX_CITATION_QUOTES) {
                console.log(`[${traceId}] Reached max citation quote limit, skipping remaining`);
                break;
            }

            const guidelineText = guidelineTextById[task.guidelineId];
            let verbatimQuote = null;

            // Only attempt quote finding if we have meaningful advice text AND guideline content
            if (task.adviceText && task.adviceText.length >= 10 && guidelineText && guidelineText.trim()) {
                try {
                    verbatimQuote = await findGuidelineQuoteInText(
                        task.guidelineId,
                        task.adviceText,
                        guidelineText,
                        userId
                    );
                    
                    // Log warning if quote finder returned null despite having content
                    if (!verbatimQuote) {
                        console.warn(`[${traceId}] Quote finder returned null for guideline with content`, {
                            guidelineId: task.guidelineId,
                            adviceTextPreview: task.adviceText.substring(0, 100),
                            contentLength: guidelineText.length
                        });
                    }
                } catch (quoteError) {
                    console.error(`[${traceId}] Error finding quote for citation:`, quoteError.message);
                }
            } else if (!guidelineText || !guidelineText.trim()) {
                // This is a data error - guideline has no content
                console.error(`[${traceId}] ⚠️ Cannot find quote - guideline has NO CONTENT`, {
                    guidelineId: task.guidelineId,
                    adviceTextPreview: task.adviceText ? task.adviceText.substring(0, 100) : 'N/A'
                });
            } else if (!task.adviceText || task.adviceText.length < 10) {
                console.warn(`[${traceId}] Skipping quote search - no advice text extracted`, {
                    guidelineId: task.guidelineId
                });
            }

            // Clean up the quote for safe use in links
            let safeQuote = '';
            if (verbatimQuote) {
                safeQuote = String(verbatimQuote)
                    .replace(/\|/g, ' ')
                    .replace(/\.{3}|…/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
            }

            // If no verbatim quote but we have meaningful advice text, use a shortened version
            // This gives the user something to search for rather than nothing
            let fallbackSearch = '';
            if (!safeQuote && task.adviceText && task.adviceText.length >= 10) {
                // Extract first 5-8 distinctive words from advice text for fallback search
                const words = task.adviceText.split(/\s+/).filter(w => w.length > 3);
                fallbackSearch = words.slice(0, 8).join(' ');
                console.log(`[${traceId}] Using fallback search from advice text`, {
                    guidelineId: task.guidelineId,
                    fallbackSearch: fallbackSearch.substring(0, 50)
                });
            }

            // Apply British spelling normalization to search text
            // (UK guidelines use British spellings, but AI often generates American)
            let finalSearchText = safeQuote || fallbackSearch;
            if (finalSearchText) {
                const britishText = normalizeAmericanToBritish(finalSearchText);
                if (britishText !== finalSearchText) {
                    console.log(`[${traceId}] Normalized search text to British spelling`, {
                        guidelineId: task.guidelineId,
                        original: finalSearchText.substring(0, 50),
                        normalized: britishText.substring(0, 50)
                    });
                    finalSearchText = britishText;
                }
            }

            citationResults.push({
                guidelineId: task.guidelineId,
                adviceText: task.adviceText ? task.adviceText.substring(0, 100) : '',
                verbatimQuote: safeQuote || null,
                fallbackSearch: fallbackSearch || null,
                finalSearchText: finalSearchText || null,
                originalTag: task.originalTag,
                guidelineTextAvailable: !!(guidelineText && guidelineText.trim())
            });

            // Replace [GuidelineID: xxx] with [[CITATION:guidelineId|searchText]]
            // The frontend will convert this to a clickable link
            enhancedAnswer = enhancedAnswer.replace(
                task.originalTag,
                `[[CITATION:${task.guidelineId}|${finalSearchText}]]`
            );
            
            if (safeQuote) {
                quotesResolved += 1;
            }
        }

        // Log citation processing summary
        console.log(`[ASK_GUIDELINES][${traceId}] === CITATION PROCESSING SUMMARY ===`);
        console.log(`[ASK_GUIDELINES][${traceId}] Total citations:`, citationResults.length);
        console.log(`[ASK_GUIDELINES][${traceId}] With verbatim quotes:`, citationResults.filter(c => c.verbatimQuote).length);
        console.log(`[ASK_GUIDELINES][${traceId}] With fallback search:`, citationResults.filter(c => !c.verbatimQuote && c.fallbackSearch).length);
        console.log(`[ASK_GUIDELINES][${traceId}] Without any search:`, citationResults.filter(c => !c.finalSearchText).length);
        console.log(`[ASK_GUIDELINES][${traceId}] Missing guideline text:`, citationResults.filter(c => !c.guidelineTextAvailable).length);
        
        // Log details for debugging if any citations failed
        const failedCitations = citationResults.filter(c => !c.finalSearchText);
        if (failedCitations.length > 0) {
            console.log(`[ASK_GUIDELINES][${traceId}] Failed citations detail:`, 
                failedCitations.map(c => ({
                    id: c.guidelineId,
                    adviceLength: c.adviceText?.length || 0,
                    hasGuidelineText: c.guidelineTextAvailable
                }))
            );
        }

        // Update the response with the enhanced answer
        if (citationResults.length > 0) {
            aiResponse = {
                ...aiResponse,
                content: enhancedAnswer
            };
        }

        // Log the AI interaction
        try {
            await logAIInteraction(
                {
                    prompt: userPrompt,
                    system_prompt: systemPrompt,
                    question_length: question.length,
                    guidelines_count: guidelinesWithContent.length,
                    guidelines: guidelinesWithContent.map(g => ({ id: g.id, title: g.title })),
                    traceId: traceId
                },
                {
                    success: true,
                    response: aiResponse.content,
                    ai_provider: aiResponse.ai_provider,
                    ai_model: aiResponse.ai_model,
                    token_usage: aiResponse.token_usage,
                    citationStats: {
                        total: citationResults.length,
                        withQuotes: citationResults.filter(c => c.verbatimQuote).length,
                        withoutQuotes: citationResults.filter(c => !c.verbatimQuote).length
                    }
                },
                'askGuidelinesQuestion'
            );
            console.log(`[ASK_GUIDELINES][${traceId}] AI interaction logged successfully`);
        } catch (logError) {
            console.error(`[ASK_GUIDELINES][${traceId}] Error logging AI interaction:`, logError.message);
        }

        console.log(`[ASK_GUIDELINES][${traceId}] === REQUEST COMPLETE ===`, {
            success: true,
            answerLength: aiResponse.content.length,
            totalCitations: citationResults.length,
            citationsWithQuotes: citationResults.filter(c => c.verbatimQuote).length
        });

        res.json({
            success: true,
            answer: aiResponse.content,
            guidelinesUsed: guidelinesWithContent.map(g => ({ id: g.id, title: g.title })),
            ai_provider: aiResponse.ai_provider,
            ai_model: aiResponse.ai_model,
            traceId: traceId  // Include trace ID for frontend debugging
        });

    } catch (error) {
        console.error(`[ASK_GUIDELINES][${traceId}] === REQUEST ERROR ===`, {
            error: error.message,
            stack: error.stack?.substring(0, 500),
            userId: req.user?.uid?.substring(0, 8) + '...',
            questionLength: req.body?.question?.length,
            guidelinesCount: req.body?.relevantGuidelines?.length
        });
        res.status(500).json({ success: false, error: error.message, traceId: traceId });
    }
});

// New endpoint to score compliance of clinical notes against guidelines
app.post('/scoreCompliance', authenticateUser, async (req, res) => {
    try {
        debugLog('[DEBUG] scoreCompliance endpoint called');
        const { originalTranscript, recommendedChanges, guidelineId, guidelineTitle } = req.body;
        const userId = req.user.uid;
        
        // Validate required fields
        if (!originalTranscript) {
            debugLog('[DEBUG] scoreCompliance: Missing original transcript');
            return res.status(400).json({ success: false, error: 'Original transcript is required' });
        }
        
        if (!recommendedChanges) {
            debugLog('[DEBUG] scoreCompliance: Missing recommended changes');
            return res.status(400).json({ success: false, error: 'Recommended changes are required' });
        }

        debugLog('[DEBUG] scoreCompliance request data:', {
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
                debugLog('[DEBUG] scoreCompliance: Fetching guideline content for ID:', guidelineId);
                const guideline = await getGuideline(guidelineId);
                guidelineContent = guideline.content || guideline.condensed || '';
                debugLog('[DEBUG] scoreCompliance: Retrieved guideline content length:', guidelineContent.length);
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

        debugLog('[DEBUG] scoreCompliance: Sending to AI', {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length
        });

        // Send to AI
        const messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        const aiResponse = await routeToAI({ messages }, userId);
        
        debugLog('[DEBUG] scoreCompliance: AI response received', {
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
            debugLog('[DEBUG] scoreCompliance: Parsed scoring result directly:', {
                overallScore: scoringResult.overallScore,
                category: scoringResult.category
            });
        } catch (parseError) {
            debugLog('[DEBUG] scoreCompliance: Direct JSON parse failed, trying to extract from markdown:', {
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
                    debugLog('[DEBUG] scoreCompliance: Extracted JSON from markdown code blocks');
                } else {
                    // Look for JSON object without code blocks
                    const objectMatch = jsonContent.match(/(\{[\s\S]*\})/);
                    if (objectMatch) {
                        jsonContent = objectMatch[1];
                        debugLog('[DEBUG] scoreCompliance: Extracted JSON object from text');
                    }
                }
                
                // Clean up any extra text before/after JSON
                jsonContent = jsonContent.trim();
                
                debugLog('[DEBUG] scoreCompliance: Attempting to parse extracted JSON:', {
                    extractedLength: jsonContent.length,
                    extractedPreview: jsonContent.substring(0, 200)
                });
                
                scoringResult = JSON.parse(jsonContent);
                
                debugLog('[DEBUG] scoreCompliance: Successfully parsed extracted JSON:', {
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
                debugLog('[DEBUG] scoreCompliance: Using fallback scoring result');
                
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
            debugLog('[DEBUG] scoreCompliance: Stored scoring result in database with sessionId:', sessionId);
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
            debugLog('[DEBUG] scoreCompliance: AI interaction logged successfully');
        } catch (logError) {
            console.error('[DEBUG] scoreCompliance: Error logging AI interaction:', logError.message);
        }

        debugLog('[DEBUG] scoreCompliance: Returning response', {
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