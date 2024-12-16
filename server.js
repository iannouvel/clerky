const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config(); // For environment variables
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const helmet = require('helmet');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
  origin: [
    'https://iannouvel.github.io',  // Your GitHub pages domain
    'http://localhost:3000'         // Local development
  ],
  methods: ['GET', 'POST'],
  credentials: true,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
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
const githubToken = process.env.GITHUB_TOKEN; // GitHub token for authentication

// Function to validate if the response is valid HTML
function isValidHTML(htmlString) {
    return /<html.*?>/.test(htmlString) && /<\/html>/.test(htmlString);
}

// Function to fetch the SHA of the existing file on GitHub
async function getFileSha(filePath) {
    try {
        const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
        const response = await axios.get(url, {
            headers: {
                Authorization: `Bearer ${githubToken}`,
            },
        });
        return response.data.sha; // Return the SHA of the existing file
    } catch (error) {
        console.error('Error fetching file SHA from GitHub:', error.response?.data || error.message);
        throw new Error('Failed to fetch file SHA from GitHub');
    }
}

// Function to update the HTML file on GitHub
async function updateHtmlFileOnGitHub(filePath, newHtmlContent, fileSha) {
    const url = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;
    const message = `Update ${filePath} with new HTML content`;
    
    const body = {
        message: message,
        content: Buffer.from(newHtmlContent).toString('base64'), // Convert HTML to base64 encoding
        sha: fileSha,
        branch: githubBranch,
    };

    try {
        const response = await axios.put(url, body, {
            headers: {
                Authorization: `Bearer ${githubToken}`,
            },
        });
        return response.data.commit; // Return the commit details
    } catch (error) {
        console.error('Error updating HTML file on GitHub:', error.response?.data || error.message);
        throw new Error('Failed to update HTML file on GitHub');
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
async function sendToOpenAI(prompt) {
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const url = 'https://api.openai.com/v1/chat/completions';

    const body = {
        model: 'gpt-4-turbo',  // Use GPT-4 Turbo
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,  // Set a reasonable limit for completion (output)
        temperature: 0.1
    };

    try {
        const response = await axios.post(url, body, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${openaiApiKey}`
            }
        });

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
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).send('Prompt is required');
  }

  try {
    const response = await sendToOpenAI(prompt);
    res.json({ success: true, response });
  } catch (error) {
    console.error('Error in /newFunctionName route:', error.message);
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
        const response = await sendToOpenAI(prompt);
        res.json({ success: true, response });
    } catch (error) {
        console.error('Error in /newActionEndpoint route:', error.message);
        res.status(500).json({ message: error.message });
    }
});

// Original SendToAI endpoint for backward compatibility
app.post('/SendToAI', async (req, res) => {
    const { prompt, selectedGuideline, comments } = req.body; // Ensure comments are included
    const filePath = `algos/${selectedGuideline}`; // The path to the HTML file in the repository

    if (!prompt || !selectedGuideline) {
        return res.status(400).send('Prompt and selected guideline are required');
    }

    try {
        // Fetch the condensed guideline content
        const condensedText = await fetchCondensedFile(selectedGuideline);

        // Construct the final prompt with instructions to only return HTML code
        const finalPrompt = `
            The following is HTML code for a clinical algorithm based on the guideline:
            ${condensedText}

            Here are additional comments provided by the user: ${comments}

            Please maintain the previously used web page structure: with two columns, variables on the left and guidance on the right.
            The HTML previously generated was the result of code which automates the transformation of clinical guidelines from static PDF documents into a dynamic, interactive web tool. It starts by extracting and processing the core information from the guideline, such as identifying different clinical contexts or scenarios (e.g., antenatal care, postnatal care). These contexts are paired with key questions that help categorize patients based on their situation.
            Using this structured data, the guideline is rewritten into specific sections, each tailored to a different clinical context. The advice is customized for each scenario, and relevant variables—like medical conditions or patient details—are identified and included in the guidance.
            The final result is an interactive HTML page that allows users to engage with the guideline dynamically. The page features a dropdown menu where users can select their clinical context, and as they answer questions, the guidance updates in real time to reflect the specific needs of their situation. This HTML page is fully self-contained, integrating all necessary HTML, CSS, and JavaScript, and provides an accessible, user-friendly interface for navigating complex medical guidelines.

            When adjusting the HTML code - please return only valid HTML code, without explanations or comments. Do not include any extra text, just the HTML code.
        `;

        // Send the prompt to OpenAI and get the response
        const generatedHtml = await sendToOpenAI(finalPrompt);

        // Validate the returned response - check if it's valid HTML
        if (isValidHTML(generatedHtml)) {
            // Fetch the SHA of the current file from GitHub
            const fileSha = await getFileSha(filePath);

            // Update the HTML file in the GitHub repository
            const commit = await updateHtmlFileOnGitHub(filePath, generatedHtml, fileSha);
            res.json({ message: 'HTML file updated successfully', commit });
        } else {
            res.status(400).json({ message: 'The generated content is not valid HTML.' });
        }
    } catch (error) {
        console.error('Error in SendToAI route:', error.message);
        res.status(500).json({ message: error.message });
    }
});

// Endpoint to handle summary text and return list of issues
app.post('/handleIssues', async (req, res) => {
    const { prompt } = req.body;

    if (!prompt) {
        return res.status(400).json({
            success: false,
            message: 'Prompt is required'
        });
    }

    try {
        // Send the prompt to AI to extract clinical issues
        const aiResponse = await sendToOpenAI(prompt);

        // Assuming the AI returns issues as a list of lines
        const issues = aiResponse.split('\n').map(issue => issue.trim()).filter(issue => issue);

        res.json({ success: true, issues });
    } catch (error) {
        console.error('Error in /handleIssues:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process the summary text'
        });
    }
});

// Endpoint to handle each issue and return relevant guidelines
app.post('/handleGuidelines', async (req, res) => {
    const { prompt, filenames, summaries } = req.body;

    if (!prompt || !filenames || !summaries) {
        console.log('Prompt, filenames, or summaries are missing in /handleGuidelines');
        return res.status(400).json({
            success: false,
            message: 'Prompt, filenames, and summaries are required'
        });
    }

    console.log('Received request for /handleGuidelines with prompt:', prompt);

    try {
        // Construct the full prompt to send to OpenAI
        let fullPrompt = `Please provide filenames of the 3 most relevant guidelines for the following clinical issue. 
        Please only list the filenames, without prior or trailing text.\n\nIssue: ${prompt}\n\n`;

        // Append filenames and summaries to the prompt
        filenames.forEach((filename, index) => {
            fullPrompt += `${filename}: ${summaries[index]}\n`;
        });

        console.log('Full prompt sent to AI:', fullPrompt);

        // Send the prompt to AI to get relevant guidelines for the issue
        const aiResponse = await sendToOpenAI(fullPrompt);
        console.log('AI Response for /handleGuidelines:', aiResponse);

        // Assuming the AI returns filenames as a list of lines
        const guidelines = aiResponse.split('\n').map(guideline => guideline.trim()).filter(guideline => guideline);
        console.log('Extracted guidelines:', guidelines);

        res.json({ success: true, guidelines });
    } catch (error) {
        console.error('Error in /handleGuidelines:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve relevant guidelines'
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
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
