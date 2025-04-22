const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const axios = require('axios');

// Environment variables for API keys
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

// Initialize OpenAI client if API key is available
const openai = OPENAI_API_KEY ? new OpenAI({
  apiKey: OPENAI_API_KEY,
}) : null;

async function fetchOpenAIUsage() {
  try {
    if (!openai) {
      console.log('OpenAI API key not available, skipping OpenAI usage data');
      return null;
    }
    
    // Get current date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Get usage data from OpenAI
    const usage = await openai.dashboard.usage();
    
    // Format the data
    const summary = {
      date: dateStr,
      provider: 'OpenAI',
      total_tokens: 0,
      total_cost_usd: 0,
      models: {}
    };
    
    // Process usage data
    for (const item of usage.data) {
      const model = item.snapshot_id;
      const tokens = item.n_context_tokens_total + item.n_generated_tokens_total;
      const cost = item.cost;
      
      // Add to total
      summary.total_tokens += tokens;
      summary.total_cost_usd += cost;
      
      // Add model breakdown
      summary.models[model] = {
        tokens,
        cost_usd: cost
      };
    }
    
    return summary;
  } catch (error) {
    console.error('Error fetching OpenAI API usage:', error);
    return {
      date: new Date().toISOString().split('T')[0],
      provider: 'OpenAI',
      error: error.message,
      total_tokens: 0,
      total_cost_usd: 0,
      models: {}
    };
  }
}

async function fetchDeepSeekUsage() {
  try {
    if (!DEEPSEEK_API_KEY) {
      console.log('DeepSeek API key not available, skipping DeepSeek usage data');
      return null;
    }
    
    // Get current date in YYYY-MM-DD format
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // DeepSeek API doesn't have a usage endpoint yet, so we'll create a placeholder
    // This should be updated once DeepSeek provides a usage API
    
    const summary = {
      date: dateStr,
      provider: 'DeepSeek',
      total_tokens: 0,  // This would need to be tracked manually for now
      total_cost_usd: 0,
      models: {
        'deepseek-chat': {
          tokens: 0,
          cost_usd: 0
        }
      },
      note: 'DeepSeek usage data is not available through API. This is a placeholder.'
    };
    
    return summary;
  } catch (error) {
    console.error('Error with DeepSeek usage data:', error);
    return {
      date: new Date().toISOString().split('T')[0],
      provider: 'DeepSeek',
      error: error.message,
      total_tokens: 0,
      total_cost_usd: 0,
      models: {}
    };
  }
}

async function saveUsageData(data) {
  if (!data) return;
  
  // Create directories if they don't exist
  const rawDir = path.join(__dirname, '..', 'data', 'api-usage', 'raw');
  const processedDir = path.join(__dirname, '..', 'data', 'api-usage', 'processed');
  
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  
  // Save raw data with provider name
  const rawFilePath = path.join(rawDir, `${data.date}-${data.provider.toLowerCase()}.json`);
  fs.writeFileSync(rawFilePath, JSON.stringify(data, null, 2));
  
  // Update processed data (weekly and monthly summaries)
  updateProcessedData(data);
  
  console.log(`API usage data saved for ${data.provider} on ${data.date}`);
}

function updateProcessedData(data) {
  const processedDir = path.join(__dirname, '..', 'data', 'api-usage', 'processed');
  
  // Current month and year
  const date = new Date(data.date);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  
  // Update monthly summary for specific provider
  const monthlyFile = path.join(processedDir, `${year}-${month.toString().padStart(2, '0')}-${data.provider.toLowerCase()}.json`);
  let monthlySummary = { days: [] };
  
  if (fs.existsSync(monthlyFile)) {
    monthlySummary = JSON.parse(fs.readFileSync(monthlyFile, 'utf8'));
    
    // Remove existing entry for this day if it exists
    monthlySummary.days = monthlySummary.days.filter(day => day.date !== data.date);
  }
  
  // Add new day data
  monthlySummary.days.push(data);
  
  // Sort by date
  monthlySummary.days.sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Calculate monthly totals
  monthlySummary.total_tokens = monthlySummary.days.reduce((sum, day) => sum + day.total_tokens, 0);
  monthlySummary.total_cost_usd = monthlySummary.days.reduce((sum, day) => sum + day.total_cost_usd, 0);
  monthlySummary.provider = data.provider;
  
  // Save monthly summary
  fs.writeFileSync(monthlyFile, JSON.stringify(monthlySummary, null, 2));
  
  // Create combined monthly report for all providers
  createCombinedMonthlyReport(year, month);
}

function createCombinedMonthlyReport(year, month) {
  const processedDir = path.join(__dirname, '..', 'data', 'api-usage', 'processed');
  const monthStr = month.toString().padStart(2, '0');
  const openaiFile = path.join(processedDir, `${year}-${monthStr}-openai.json`);
  const deepseekFile = path.join(processedDir, `${year}-${monthStr}-deepseek.json`);
  const combinedFile = path.join(processedDir, `${year}-${monthStr}-combined.json`);
  
  let combined = {
    year,
    month: monthStr,
    providers: {},
    total_tokens: 0,
    total_cost_usd: 0
  };
  
  // Add OpenAI data if available
  if (fs.existsSync(openaiFile)) {
    const openaiData = JSON.parse(fs.readFileSync(openaiFile, 'utf8'));
    combined.providers.OpenAI = {
      total_tokens: openaiData.total_tokens,
      total_cost_usd: openaiData.total_cost_usd,
      days: openaiData.days.length
    };
    combined.total_tokens += openaiData.total_tokens;
    combined.total_cost_usd += openaiData.total_cost_usd;
  }
  
  // Add DeepSeek data if available
  if (fs.existsSync(deepseekFile)) {
    const deepseekData = JSON.parse(fs.readFileSync(deepseekFile, 'utf8'));
    combined.providers.DeepSeek = {
      total_tokens: deepseekData.total_tokens,
      total_cost_usd: deepseekData.total_cost_usd,
      days: deepseekData.days.length
    };
    combined.total_tokens += deepseekData.total_tokens;
    combined.total_cost_usd += deepseekData.total_cost_usd;
  }
  
  // Save combined report
  fs.writeFileSync(combinedFile, JSON.stringify(combined, null, 2));
}

async function main() {
  try {
    // Fetch usage data from both providers
    const openaiData = await fetchOpenAIUsage();
    const deepseekData = await fetchDeepSeekUsage();
    
    // Save data from each provider
    if (openaiData) await saveUsageData(openaiData);
    if (deepseekData) await saveUsageData(deepseekData);
    
    console.log('API usage tracking completed successfully');
  } catch (error) {
    console.error('Failed to track API usage:', error);
    process.exit(1);
  }
}

main(); 