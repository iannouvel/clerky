import axios from 'axios';

const SERVER_URL = 'https://clerky-uzni.onrender.com';
const GITHUB_API_BASE = 'https://api.github.com/repos/iannouvel/clerky';

export const api = {
  // Server health check
  checkServerHealth: async () => {
    try {
      const response = await axios.get(`${SERVER_URL}/health`);
      return response.status === 200;
    } catch (error) {
      console.error('Server health check failed:', error);
      return false;
    }
  },

  // Guidelines
  fetchGuidelines: async () => {
    try {
      const response = await axios.get('https://raw.githubusercontent.com/iannouvel/clerky/main/guidance/summary/list_of_summaries.json');
      return response.data;
    } catch (error) {
      console.error('Error fetching guidelines:', error);
      throw error;
    }
  },

  // Prompts
  fetchPrompts: async () => {
    try {
      const response = await axios.get('https://raw.githubusercontent.com/iannouvel/clerky/main/prompts.json');
      return response.data;
    } catch (error) {
      console.error('Error fetching prompts:', error);
      throw error;
    }
  },

  // Logs
  fetchLogs: async () => {
    try {
      const response = await axios.get(`${GITHUB_API_BASE}/contents/logs/ai-interactions`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      const files = response.data
        .filter(file => file.type === 'file' && file.name.endsWith('.txt'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 100); // Limit to 100 most recent files
      
      return files;
    } catch (error) {
      console.error('Error fetching logs:', error);
      throw error;
    }
  },

  // Log content
  fetchLogContent: async (downloadUrl) => {
    try {
      const response = await axios.get(downloadUrl);
      return response.data;
    } catch (error) {
      console.error('Error fetching log content:', error);
      throw error;
    }
  },

  // Handle clinical issues
  handleIssues: async (prompt, token) => {
    try {
      const response = await axios.post(`${SERVER_URL}/handleIssues`, 
        { prompt },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/json'
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('Error handling issues:', error);
      throw error;
    }
  }
}; 