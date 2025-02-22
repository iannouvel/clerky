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

const app = express();
const PORT = process.env.PORT || 3000;

// Enable trust proxy
app.set('trust proxy', true);

// Increase payload limits
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const corsOptions = {
  origin: [
    'https://iannouvel.github.io',  // Your GitHub pages domain
    'http://localhost:3000',        // Local development
    'http://localhost:5500'         // VS Code Live Server
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));

// Add OPTIONS handler for preflight requests
app.options('*', cors(corsOptions));

// Update custom headers middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (corsOptions.origin.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
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
app.use('/newFunctionName', apiLimiter);
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

// Log token format (safely)
console.log('GitHub token format check:', {
    length: githubToken.length,
    prefix: githubToken.substring(0, 4),
    isBearer: githubToken.startsWith('ghp_') || githubToken.startsWith('github_pat_')
});

// Function to validate if the response is valid HTML
function isValidHTML(htmlString) {
    return /<html.*?>/.test(htmlString) && /<\/html>/.test(htmlString);
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
    
    // Log token format (safely)
    console.log('GitHub token format check:', {
        length: cleanToken.length,
        prefix: cleanToken.substring(0, 4),
        isGitHubToken: cleanToken.startsWith('ghp_') || cleanToken.startsWith('github_pat_')
    });

    // Update the global token
    githubToken = cleanToken;
}

// Call validation on startup
validateGitHubToken();

// Function to fetch the SHA of the existing file on GitHub
async function getFileSha(filePath) {
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}?ref=${githubBranch}`;
        console.log('Fetching SHA for file:', url);
        
        const headers = {
            'Accept': 'application/vnd.github.v3+json',
            'Authorization': githubToken
        };
        
        console.log('Request headers:', {
            Authorization: githubToken.substring(0, 10) + '...',
            Accept: headers.Accept
        });
        
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
            console.log('File does not exist yet, will create new file');
            return null;
        }
        throw new Error(`Failed to fetch file SHA: ${error.response?.data?.message || error.message}`);
    }
}

// Function to update the HTML file on GitHub
async function updateHtmlFileOnGitHub(filePath, newHtmlContent, fileSha) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
    console.log('Updating file:', url);
    console.log('Using SHA:', fileSha);
    
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
                'Authorization': githubToken
            }
        });
        return {
            commit: response.data.commit,
            content: response.data.content
        };
    } catch (error) {
        console.error('GitHub API Error:', {
            status: error.response?.status,
            statusText: error.response?.statusText,
            message: error.response?.data?.message,
            documentation_url: error.response?.data?.documentation_url
        });
        throw new Error(`Failed to update file: ${error.response?.data?.message || error.message}`);
    }
}

// Function to fetch the condensed file from GitHub
async function fetchCondensedFile(guidelineFilename) {
    // Replace .html with .pdf and add ' - condensed.txt' to get the correct file
    const pdfFilename = guidelineFilename.replace('.html', '.pdf') + ' - condensed.txt';
    const url = `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${githubBranch}/${githubFolder}/${encodeURIComponent(pdfFilename)}`;

    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error('Error fetching condensed file from GitHub:', error.response?.data || error.message);
        throw new Error('Failed to retrieve the condensed guideline');
    }
}

// Function to send the prompt to OpenAI using GPT-4 Turbo (ChatGPT Turbo)
async function sendToOpenAI(prompt, model = 'gpt-3.5-turbo', systemPrompt = null) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [];
    
    // Add system prompt if provided
    if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
    }
    
    // Add user prompt
    messages.push({ role: 'user', content: prompt });

    const body = {
        model: model,
        messages: messages,
        max_tokens: 1000,
        temperature: 0.1
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            }
        });

        // Extract the content from the response
        return response.data.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error calling OpenAI API:', error.response?.data || error.message);
        throw new Error('Failed to generate response from OpenAI');
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
app.post('/handleAction', async (req, res) => {
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
        const aiResponse = await sendToOpenAI(prompt);

        if (!aiResponse || !aiResponse.choices) {
            throw new Error('Invalid AI response');
        }

        // Extract the relevant guidelines from AI's response
        const relevantGuidelines = aiResponse.choices[0].text.trim().split('\n')
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
app.post('/newFunctionName', authenticateUser, [
  body('prompt').trim().notEmpty().escape(),
], async (req, res) => {
  // Add CORS headers specifically for this endpoint
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).send('Prompt is required');
  }

  try {
    // Load prompts configuration
    const prompts = require('./prompts.json');
    const systemPrompt = prompts.noteGenerator.system_prompt;
    
    const response = await sendToOpenAI(prompt, 'gpt-3.5-turbo', systemPrompt);
    
    // Log the interaction
    try {
        await logAIInteraction({
            prompt,
            system_prompt: systemPrompt
        }, {
            success: true,
            response
        }, 'newFunctionName');
    } catch (logError) {
        console.error('Error logging interaction:', logError);
    }
    
    res.json({ success: true, response });
  } catch (error) {
    console.error('Error in /newFunctionName route:', error.message);
    
    // Log the error with system prompt
    try {
        await logAIInteraction({
            prompt,
            system_prompt: prompts.noteGenerator.system_prompt
        }, {
            success: false,
            error: error.message
        }, 'newFunctionName');
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
        
        const response = await sendToOpenAI(prompt, 'gpt-3.5-turbo', systemPrompt);
        
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
                    'Authorization': `Bearer ${githubToken}`
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
                    'Authorization': `Bearer ${githubToken}`
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
                    'Authorization': `Bearer ${githubToken}`
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
                    'Authorization': `Bearer ${githubToken}`
                }
            });
            results.actions = true;
        } catch (error) {
            results.details.actions = `Error: ${error.response?.status} - ${error.response?.data?.message}`;
        }

        console.log('\nGitHub Permissions Check Results:', {
            allPermissionsGranted: Object.values(results).slice(0, 4).every(v => v),
            permissions: {
                repository: results.repository ? '✅' : '❌',
                contents: results.contents ? '✅' : '❌',
                workflows: results.workflows ? '✅' : '❌',
                actions: results.actions ? '✅' : '❌'
            },
            details: results.details
        });

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
                'Authorization': `Bearer ${githubToken}`
            }
        });
        console.log('GitHub repository access test:', {
            status: response.status,
            permissions: response.data.permissions,
            repoName: response.data.full_name
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

// Update the saveToGitHub function with proper content handling
async function saveToGitHub(content, type) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Save the JSON file
        const jsonFilename = `${timestamp}-${type}.json`;
        const jsonPath = `logs/ai-interactions/${jsonFilename}`;
        
        console.log(`Attempting to save ${type} to GitHub:`, {
            path: jsonPath,
            repoDetails: `${githubOwner}/${githubRepo}`,
            contentLength: JSON.stringify(content).length
        });

        const jsonBody = {
            message: `Add ${type} log: ${timestamp}`,
            content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
            branch: githubBranch
        };

        // Save text version based on type
        let textContent = '';
        if (type === 'submission' && content.prompt?.prompt) {
            textContent = content.prompt.prompt;
        } else if (type === 'reply' && content.response) {
            // Handle both string and object responses
            if (typeof content.response === 'string') {
                // Format string response with proper line breaks
                textContent = content.response.split('\\n').join('\n');
            } else if (content.response.response) {
                // Handle nested response object
                textContent = content.response.response.split('\\n').join('\n');
            } else {
                // Fallback to JSON stringify for other cases
                textContent = JSON.stringify(content.response, null, 2);
            }
        }

        if (textContent) {
            const textFilename = `${timestamp}-${type}.txt`;
            const textPath = `logs/ai-interactions/${textFilename}`;
            const textBody = {
                message: `Add ${type} text: ${timestamp}`,
                content: Buffer.from(textContent).toString('base64'),
                branch: githubBranch
            };

            try {
                await axios.put(
                    `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${textPath}`,
                    textBody,
                    {
                        headers: {
                            'Accept': 'application/vnd.github.v3+json',
                            'Authorization': `token ${githubToken}`
                        }
                    }
                );
                console.log(`Successfully saved ${type} text file: ${textPath}`);
            } catch (error) {
                console.error(`Error saving ${type} text file:`, error.response?.data);
            }
        }

        // Save the JSON file
        const jsonUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${jsonPath}`;
        try {
            const response = await axios.put(jsonUrl, jsonBody, {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `token ${githubToken}`
                }
            });
            
            console.log(`Successfully saved ${type} to GitHub:`, {
                path: response.data.content.path,
                sha: response.data.content.sha.substring(0, 7)
            });
        } catch (error) {
            if (error.response?.status === 404) {
                console.error('Error 404: Repository or path not found. This might be a permissions issue.');
                const permissions = await checkGitHubPermissions();
                console.error('Current permissions state:', permissions);
            } else if (error.response?.status === 401) {
                console.error('Error 401: Authentication failed. Token might be expired or invalid.');
                console.error('Token details:', {
                    length: githubToken.length,
                    prefix: githubToken.substring(0, 10).replace(/[a-zA-Z0-9]/g, '*'),
                    hasBearer: githubToken.startsWith('Bearer ')
                });
            }
            throw error;
        }
    } catch (error) {
        console.error(`Error saving ${type} to GitHub:`, {
            status: error.response?.status,
            message: error.response?.data?.message,
            documentation_url: error.response?.data?.documentation_url,
            requestUrl: error.config?.url,
            requestHeaders: {
                ...error.config?.headers,
                Authorization: 'token [REDACTED]'
            }
        });
        throw error;
    }
}

// Function to log AI interaction
async function logAIInteraction(prompt, response, endpoint) {
    // Save submission
    await saveToGitHub({
        timestamp: new Date().toISOString(),
        endpoint,
        prompt,
        userEmail: prompt.userEmail // if available
    }, 'submission');

    // Save reply
    await saveToGitHub({
        timestamp: new Date().toISOString(),
        endpoint,
        response,
        success: response.success,
        error: response.error
    }, 'reply');
}

// Update the handleIssues endpoint to use system prompt
app.post('/handleIssues', async (req, res) => {
    const { prompt } = req.body;

    console.log('\n=== handleIssues Request ===');
    console.log('Full prompt text:');
    console.log(prompt);
    console.log('\n=== End Request ===\n');

    if (!prompt) {
        console.log('Error: No prompt provided');
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
        
        const aiResponse = await sendToOpenAI(enhancedPrompt, 'gpt-3.5-turbo', systemPrompt);
        
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

        const issues = aiResponse
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
        const systemPrompt = prompts.noteGenerator.system_prompt;
        const condensedText = await fetchCondensedFile(selectedGuideline);
        const finalPrompt = `
            The following is HTML code for a clinical algorithm based on the guideline:
            ${condensedText}

            Here are additional comments provided by the user: ${comments}

            Please maintain the previously used web page structure: with two columns, variables on the left and guidance on the right.
            The HTML previously generated was the result of code which automates the transformation of clinical guidelines from static PDF documents into a dynamic, interactive web tool.`;

        const generatedHtml = await sendToOpenAI(finalPrompt, 'gpt-3.5-turbo', systemPrompt);

        // Log the interaction
        await logAIInteraction({
            prompt: finalPrompt,
            selectedGuideline,
            comments,
            system_prompt: systemPrompt
        }, {
            success: true,
            generatedHtml: generatedHtml.substring(0, 500) + '...' // Log first 500 chars only
        }, 'SendToAI');

        if (isValidHTML(generatedHtml)) {
            const fileSha = await getFileSha(filePath);
            const commit = await updateHtmlFileOnGitHub(filePath, generatedHtml, fileSha);
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
            system_prompt: prompts.noteGenerator.system_prompt
        }, {
            success: false,
            error: error.message
        }, 'SendToAI');
        
        res.status(500).json({ message: error.message });
    }
});

// Update the /handleGuidelines endpoint with debugging
app.post('/handleGuidelines', authenticateUser, async (req, res) => {
    const { prompt, filenames, summaries } = req.body;

    // Debug log the incoming request
    console.log('\n=== handleGuidelines Request ===');
    console.log('Request body size:', JSON.stringify(req.body).length);
    console.log('Filenames length:', filenames?.length);
    console.log('Summaries length:', summaries?.length);

    if (!prompt || !filenames || !summaries) {
        console.error('Missing required fields:', { prompt: !!prompt, filenames: !!filenames, summaries: !!summaries });
        return res.status(400).json({
            success: false,
            message: 'Prompt, filenames, and summaries are required'
        });
    }

    try {
        // Validate array lengths match
        if (filenames.length !== summaries.length) {
            throw new Error('Filenames and summaries arrays must have the same length');
        }

        // Load prompts configuration
        const prompts = require('./prompts.json');
        const systemPrompt = prompts.guidelines.system_prompt;

        console.log('\n=== Sending to OpenAI ===');
        console.log('Prompt length:', prompt.length);

        const aiResponse = await sendToOpenAI(prompt, 'gpt-3.5-turbo', systemPrompt);
        
        // Log the interaction
        try {
            await logAIInteraction({
                prompt,
                system_prompt: systemPrompt,
                filenames,
                summaries
            }, {
                success: true,
                response: aiResponse
            }, 'handleGuidelines');
        } catch (logError) {
            console.error('Error logging interaction:', logError);
        }

        console.log('\n=== OpenAI Response ===');
        console.log('Response length:', aiResponse.length);

        // Process the response to get clean filenames
        const guidelines = aiResponse
            .split('\n')
            .map(line => line.trim())
            .filter(line => {
                return filenames.some(filename => 
                    line.includes(filename) || 
                    filename.includes(line) ||
                    line.replace(/\.(txt|pdf)$/i, '').includes(filename.replace(/\.(txt|pdf)$/i, ''))
                );
            })
            .map(line => {
                const matchingFilename = filenames.find(filename => 
                    line.includes(filename) || 
                    filename.includes(line) ||
                    line.replace(/\.(txt|pdf)$/i, '').includes(filename.replace(/\.(txt|pdf)$/i, ''))
                );
                return matchingFilename || line;
            });

        console.log('Processed guidelines:', guidelines);
        console.log('Number of guidelines found:', guidelines.length);

        res.json({ success: true, guidelines });
    } catch (error) {
        console.error('Error in /handleGuidelines:', error);
        
        // Log the error with system prompt
        try {
            await logAIInteraction({
                prompt,
                system_prompt: prompts.guidelines.system_prompt,
                filenames,
                summaries
            }, {
                success: false,
                error: error.message
            }, 'handleGuidelines');
        } catch (logError) {
            console.error('Error logging failure:', logError);
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve relevant guidelines',
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
                'Authorization': githubToken
            }
        });
        console.log('Folder exists:', response.data);
        return true;
    } catch (error) {
        if (error.response?.status === 404) {
            console.log('Folder does not exist:', folderPath);
            return false;
        }
        console.error('Error checking folder:', error);
        throw error;
    }
}

// Add this new endpoint to handle guideline uploads
app.post('/uploadGuideline', authenticateUser, upload.single('file'), async (req, res) => {
    if (!req.file) {
        console.error('No file uploaded');
        return res.status(400).json({ message: 'No file uploaded' });
    }

    try {
        const folderExists = await checkFolderExists(githubFolder);
        if (!folderExists) {
            return res.status(400).json({ message: 'Target folder does not exist in the repository' });
        }

        const file = req.file;
        const fileName = file.originalname;
        const fileContent = file.buffer;

        console.log('Uploading file:', fileName);

        // Create the file in the GitHub repository
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${githubFolder}/${fileName}`;
        console.log('GitHub API URL:', url);
        
        const body = {
            message: `Add new guideline: ${fileName}`,
            content: fileContent.toString('base64'),
            branch: githubBranch
        };

        console.log('GitHub API request body:', body);

        const response = await axios.put(url, body, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': githubToken
            }
        });

        console.log('GitHub API response:', response.data);

        // Update the list_of_guidelines.txt file
        await updateGuidelinesList(fileName);

        res.json({
            success: true,
            message: 'Guideline uploaded successfully',
            data: response.data
        });
    } catch (error) {
        console.error('Error uploading guideline:', {
            message: error.message,
            stack: error.stack,
            response: error.response?.data
        });
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to upload guideline'
        });
    }
});

// Helper function to update the list of guidelines
async function updateGuidelinesList(newFileName) {
    try {
        const listUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/list_of_guidelines.txt`;
        const listResponse = await axios.get(listUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': githubToken
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
                    'Authorization': githubToken
                }
            });
        }
    } catch (error) {
        console.error('Error updating guidelines list:', error);
        throw error;
    }
}

// Update the function that gets file contents
async function getFileContents(fileName) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${githubFolder}/${fileName}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': githubToken
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting file contents:', error.response?.data || error.message);
        throw new Error('Failed to get file contents');
    }
}

// Update the function that gets list of guidelines
async function getGuidelinesList() {
    const listUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/list_of_guidelines.txt`;
    try {
        const response = await axios.get(listUrl, {
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': githubToken
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
                    'Authorization': githubToken
                }
            }
        );
        console.log(`Workflow ${workflowId} triggered successfully`);
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
                    'Authorization': githubToken
                }
            }
        );
        console.log(`Repository dispatch event ${eventType} created successfully`);
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
        console.log('Processing commit for file:', filePath);

        // Get the current file's SHA (null if file doesn't exist)
        const fileSha = await getFileSha(filePath);
        console.log('File SHA:', fileSha);

        // Update or create the file on GitHub
        const commitResult = await updateHtmlFileOnGitHub(filePath, content, fileSha);
        console.log('Commit result:', commitResult);

        // Trigger the workflow to update list_of_guidelines.txt
        try {
            await createRepositoryDispatch('update_guidelines_list', { fileName });
            console.log('Triggered workflow to update guidelines list');
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

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  })
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log('\nChecking GitHub token and permissions...');
    
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
