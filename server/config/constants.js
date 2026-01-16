
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

// Comprehensive AI Model Registry - all available models per provider with accurate pricing
// Pricing is per 1k tokens (input/output separated for accuracy)
const AI_MODEL_REGISTRY = {
    OpenAI: {
        keyEnv: 'OPENAI_API_KEY',
        endpoint: 'https://api.openai.com/v1/chat/completions',
        models: [
            { model: 'gpt-4.1', displayName: 'GPT-4.1', costPer1kInput: 0.003, costPer1kOutput: 0.012, description: 'Smartest non-reasoning model' },
            { model: 'gpt-4o', displayName: 'GPT-4o', costPer1kInput: 0.0025, costPer1kOutput: 0.01, description: 'Flagship multimodal model' },
            { model: 'gpt-4o-mini', displayName: 'GPT-4o Mini', costPer1kInput: 0.00015, costPer1kOutput: 0.0006, description: 'Fast and affordable' },
            { model: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', costPer1kInput: 0.0005, costPer1kOutput: 0.0015, description: 'Legacy fast model' }
        ]
    },
    Anthropic: {
        keyEnv: 'ANTHROPIC_API_KEY',
        endpoint: 'https://api.anthropic.com/v1/messages',
        models: [
            { model: 'claude-opus-4-5', displayName: 'Claude Opus 4.5', costPer1kInput: 0.005, costPer1kOutput: 0.025, description: 'Most intelligent model' },
            { model: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', costPer1kInput: 0.003, costPer1kOutput: 0.015, description: 'Balanced performance for coding and agents' },
            { model: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', costPer1kInput: 0.001, costPer1kOutput: 0.005, description: 'Fastest with near-frontier intelligence' },
            { model: 'claude-sonnet-4-20250514', displayName: 'Claude Sonnet 4', costPer1kInput: 0.003, costPer1kOutput: 0.015, description: 'Previous generation Sonnet' },
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
            { model: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', costPer1kInput: 0.0005, costPer1kOutput: 0.003, description: 'Latest fast model with advanced reasoning (Preview)' },
            { model: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', costPer1kInput: 0.00015, costPer1kOutput: 0.0006, description: 'Fast and cost-effective' },
            { model: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', costPer1kInput: 0.00125, costPer1kOutput: 0.005, description: 'Most capable Gemini' },
            { model: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', costPer1kInput: 0.0001, costPer1kOutput: 0.0004, description: 'Previous generation flash' }
        ]
    },
    Groq: {
        keyEnv: 'GROQ_API_KEY',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        models: [
            { model: 'groq/compound', displayName: 'Groq Compound', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Agentic system with web search and code execution' },
            { model: 'groq/compound-mini', displayName: 'Groq Compound Mini', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Lightweight agentic system' },
            { model: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B', costPer1kInput: 0.00005, costPer1kOutput: 0.00008, description: 'Ultra-fast 560 T/s' },
            { model: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B', costPer1kInput: 0.00059, costPer1kOutput: 0.00079, description: 'Llama 3.3 70B versatile' },
            { model: 'meta-llama/llama-4-scout-17b-16e-instruct', displayName: 'Llama 4 Scout', costPer1kInput: 0.00011, costPer1kOutput: 0.00034, description: 'Llama 4 Scout 17B 750 T/s' },
            { model: 'meta-llama/llama-4-maverick-17b-128e-instruct', displayName: 'Llama 4 Maverick', costPer1kInput: 0.0002, costPer1kOutput: 0.0006, description: 'Llama 4 Maverick 600 T/s' },
            { model: 'openai/gpt-oss-120b', displayName: 'GPT OSS 120B', costPer1kInput: 0.00015, costPer1kOutput: 0.0006, description: 'Open-source GPT 120B on Groq' },
            { model: 'openai/gpt-oss-20b', displayName: 'GPT OSS 20B', costPer1kInput: 0.000075, costPer1kOutput: 0.0003, description: 'Open-source GPT 20B on Groq' },
            { model: 'moonshotai/kimi-k2-instruct', displayName: 'Kimi K2', costPer1kInput: 0.0, costPer1kOutput: 0.0, description: 'Kimi K2 instruction model' },
            { model: 'moonshotai/kimi-k2-instruct-0905', displayName: 'Kimi K2 (New)', costPer1kInput: 0.001, costPer1kOutput: 0.003, description: 'Kimi K2 262K context' },
            { model: 'qwen/qwen3-32b', displayName: 'Qwen3 32B', costPer1kInput: 0.00029, costPer1kOutput: 0.00059, description: 'Alibaba Qwen3 32B' }
        ]
    },
    Grok: {
        keyEnv: 'GROK_API_KEY',
        endpoint: 'https://api.x.ai/v1/chat/completions',
        models: [
            { model: 'grok-4-1-fast-reasoning', displayName: 'Grok 4.1 Fast', costPer1kInput: 0.0002, costPer1kOutput: 0.0005, description: 'Frontier multimodal, 2M context' },
            { model: 'grok-4-1-fast-non-reasoning', displayName: 'Grok 4.1 Fast (Non-Reasoning)', costPer1kInput: 0.0002, costPer1kOutput: 0.0005, description: 'Fast non-reasoning, 2M context' },
            { model: 'grok-4-fast-reasoning', displayName: 'Grok 4 Fast', costPer1kInput: 0.0002, costPer1kOutput: 0.0005, description: 'Fast reasoning, 2M context' },
            { model: 'grok-4-fast-non-reasoning', displayName: 'Grok 4 Fast (Non-Reasoning)', costPer1kInput: 0.0002, costPer1kOutput: 0.0005, description: 'Fast non-reasoning, 2M context' },
            { model: 'grok-4-0709', displayName: 'Grok 4 (Flagship)', costPer1kInput: 0.003, costPer1kOutput: 0.015, description: 'Flagship Grok 4 model' }
        ]
    }
};

// Provider preference array ordered by cost (cheapest first, most expensive last)
// This ensures we try the most cost-effective providers before falling back to expensive ones
const AI_PROVIDER_PREFERENCE = [
    // Tier 1: Free/Ultra-cheap models
    {
        name: 'Groq',
        model: 'groq/compound',
        costPer1kTokens: 0.0,
        priority: 1,
        description: 'Agentic system with web search and code execution'
    },
    {
        name: 'Groq',
        model: 'groq/compound-mini',
        costPer1kTokens: 0.0,
        priority: 2,
        description: 'Lightweight agentic system'
    },
    {
        name: 'Groq',
        model: 'moonshotai/kimi-k2-instruct',
        costPer1kTokens: 0.0,
        priority: 3,
        description: 'Kimi K2 instruction model on Groq'
    },
    // Tier 2: Very cheap models
    {
        name: 'DeepSeek',
        model: 'deepseek-chat',
        costPer1kTokens: 0.00021, // Average of input/output
        priority: 4,
        description: 'Most cost-effective option'
    },
    {
        name: 'Groq',
        model: 'llama-3.1-8b-instant',
        costPer1kTokens: 0.000065, // Ultra-fast 560 T/s
        priority: 5,
        description: 'Ultra-fast Llama 3.1 8B on Groq'
    },
    {
        name: 'Gemini',
        model: 'gemini-3-flash-preview',
        costPer1kTokens: 0.00175, // Average of input/output
        priority: 5.5,
        description: 'Latest fast model with advanced reasoning (Preview)'
    },
    {
        name: 'Gemini',
        model: 'gemini-2.5-flash',
        costPer1kTokens: 0.000375, // Average of input/output
        priority: 6,
        description: 'Google\'s fast and cost-effective model'
    },
    {
        name: 'Groq',
        model: 'openai/gpt-oss-20b',
        costPer1kTokens: 0.000188, // Average of input/output
        priority: 7,
        description: 'Open-source GPT 20B on Groq'
    },
    {
        name: 'Groq',
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        costPer1kTokens: 0.000225, // Average of input/output
        priority: 8,
        description: 'Llama 4 Scout 17B on Groq - 750 T/s'
    },
    {
        name: 'Grok',
        model: 'grok-4-1-fast-reasoning',
        costPer1kTokens: 0.00035, // Average of input/output
        priority: 9,
        description: 'xAI Grok 4.1 Fast - 2M context'
    },
    {
        name: 'Grok',
        model: 'grok-4-1-fast-non-reasoning',
        costPer1kTokens: 0.00035,
        priority: 10,
        description: 'xAI Grok 4.1 Fast (Non-Reasoning)'
    },
    {
        name: 'Grok',
        model: 'grok-4-fast-reasoning',
        costPer1kTokens: 0.00035,
        priority: 10.1,
        description: 'xAI Grok 4 Fast - 2M context'
    },
    {
        name: 'Grok',
        model: 'grok-4-fast-non-reasoning',
        costPer1kTokens: 0.00035,
        priority: 10.2,
        description: 'xAI Grok 4 Fast (Non-Reasoning)'
    },
    {
        name: 'Groq',
        model: 'openai/gpt-oss-120b',
        costPer1kTokens: 0.000375, // Average of input/output
        priority: 11,
        description: 'Open-source GPT 120B on Groq'
    },
    {
        name: 'Mistral',
        model: 'mistral-large-latest',
        costPer1kTokens: 0.004, // Average of input/output
        priority: 12,
        description: 'Good balance of cost and quality'
    },
    {
        name: 'Groq',
        model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
        costPer1kTokens: 0.0004, // Average of input/output
        priority: 13,
        description: 'Llama 4 Maverick on Groq - 600 T/s'
    },
    {
        name: 'Groq',
        model: 'qwen/qwen3-32b',
        costPer1kTokens: 0.00044, // Average of input/output
        priority: 14,
        description: 'Alibaba Qwen3 32B on Groq'
    },
    // Tier 3: Mid-range models
    {
        name: 'Groq',
        model: 'llama-3.3-70b-versatile',
        costPer1kTokens: 0.00069, // Average of input/output
        priority: 16,
        description: 'Ultra-fast inference on Groq LPU - Llama 3.3 70B'
    },
    {
        name: 'Anthropic',
        model: 'claude-3-haiku-20240307',
        costPer1kTokens: 0.00075, // Average of input/output
        priority: 17,
        description: 'Fast and cost-effective Claude'
    },
    {
        name: 'Groq',
        model: 'moonshotai/kimi-k2-instruct-0905',
        costPer1kTokens: 0.002, // Average of input/output
        priority: 18,
        description: 'Kimi K2 with 262K context'
    },
    {
        name: 'Anthropic',
        model: 'claude-haiku-4-5',
        costPer1kTokens: 0.003, // Average of input/output
        priority: 20,
        description: 'Fastest Claude 4.5 with near-frontier intelligence'
    },
    // Tier 4: High-quality models
    {
        name: 'OpenAI',
        model: 'gpt-4.1',
        costPer1kTokens: 0.0075, // Average of input/output
        priority: 21,
        description: 'Smartest non-reasoning model'
    },
    {
        name: 'Anthropic',
        model: 'claude-sonnet-4-5',
        costPer1kTokens: 0.009, // Average of input/output
        priority: 22,
        description: 'Balanced Claude 4.5 for coding and agents'
    },
    {
        name: 'Grok',
        model: 'grok-4-0709',
        costPer1kTokens: 0.009, // Average of input/output
        priority: 23,
        description: 'Flagship Grok 4 model'
    },
    {
        name: 'Anthropic',
        model: 'claude-opus-4-5',
        costPer1kTokens: 0.015, // Average of input/output
        priority: 25,
        description: 'Most intelligent Claude model'
    },
    // Legacy models (kept for compatibility)
    {
        name: 'OpenAI',
        model: 'gpt-4o',
        costPer1kTokens: 0.00625, // Average of input/output
        priority: 27,
        description: 'Previous flagship OpenAI model'
    },
    {
        name: 'OpenAI',
        model: 'gpt-4o-mini',
        costPer1kTokens: 0.000375, // Average of input/output
        priority: 28,
        description: 'Fast and affordable GPT-4o'
    },
    {
        name: 'OpenAI',
        model: 'gpt-3.5-turbo',
        costPer1kTokens: 0.001, // Average of input/output
        priority: 29,
        description: 'Legacy fast model'
    }
];

module.exports = {
    ORGANIZATION_DOMAINS,
    AI_MODEL_REGISTRY,
    AI_PROVIDER_PREFERENCE
};
