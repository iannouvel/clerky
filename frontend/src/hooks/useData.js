import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../services/api';
import useStore from '../stores/useStore';

export function useData() {
  const {
    setGuidelines,
    setPrompts,
    setLogs,
    setServerStatus,
    user,
    issues,
    setIssues,
  } = useStore();

  const [isLoading, setIsLoading] = useState({
    issues: false,
    guidelines: false,
    prompts: false,
    logs: false
  });

  // Server health check
  const { data: serverHealth } = useQuery({
    queryKey: ['serverHealth'],
    queryFn: api.checkServerHealth,
    refetchInterval: 30000,
    onSuccess: (isHealthy) => {
      setServerStatus(isHealthy ? 'live' : 'down');
    },
  });

  // Guidelines
  const { data: guidelines } = useQuery({
    queryKey: ['guidelines'],
    queryFn: api.fetchGuidelines,
    onSuccess: (data) => {
      setGuidelines(data);
      setIsLoading(prev => ({ ...prev, guidelines: false }));
    },
    onError: () => {
      setIsLoading(prev => ({ ...prev, guidelines: false }));
    }
  });

  // Prompts
  const { data: prompts } = useQuery({
    queryKey: ['prompts'],
    queryFn: api.fetchPrompts,
    onSuccess: (data) => {
      setPrompts(data);
      setIsLoading(prev => ({ ...prev, prompts: false }));
    },
    onError: () => {
      setIsLoading(prev => ({ ...prev, prompts: false }));
    }
  });

  // Logs
  const { data: logs } = useQuery({
    queryKey: ['logs'],
    queryFn: api.fetchLogs,
    onSuccess: (data) => {
      setLogs(data);
      setIsLoading(prev => ({ ...prev, logs: false }));
    },
    onError: () => {
      setIsLoading(prev => ({ ...prev, logs: false }));
    }
  });

  const handleIssues = useCallback(async (input) => {
    console.log('=== handleIssues started ===');
    console.log('Input received:', input);
    
    if (!input.trim()) {
      console.log('Empty input, returning early');
      return;
    }
    
    setIsLoading(prev => ({ ...prev, issues: true }));
    console.log('Loading state set to true');
    
    try {
      // Sync the input with the old implementation's summary div
      const summaryDiv = document.getElementById('summary');
      console.log('Looking for summary div:', { found: !!summaryDiv });
      
      if (summaryDiv) {
        summaryDiv.textContent = input;
        console.log('Updated summary div content');
      } else {
        console.warn('Summary div not found in DOM');
      }

      // Get the issues from the old implementation
      const actionBtn = document.getElementById('actionBtn');
      console.log('Looking for action button:', { found: !!actionBtn });
      
      if (actionBtn) {
        console.log('Triggering action button click');
        actionBtn.click();
        
        // Wait for the response
        console.log('Waiting for response...');
        const result = await new Promise((resolve, reject) => {
          let attempts = 0;
          const maxAttempts = 100; // 10 seconds with 100ms interval
          
          const checkInterval = setInterval(() => {
            attempts++;
            const suggestedGuidelinesDiv = document.getElementById('suggestedGuidelines');
            console.log(`Check attempt ${attempts}:`, {
              divFound: !!suggestedGuidelinesDiv,
              childrenCount: suggestedGuidelinesDiv?.children.length || 0
            });
            
            if (suggestedGuidelinesDiv && suggestedGuidelinesDiv.children.length > 0) {
              clearInterval(checkInterval);
              // Extract issues from the DOM
              const issues = Array.from(suggestedGuidelinesDiv.querySelectorAll('.accordion-item h4'))
                .map(h4 => h4.textContent.trim());
              console.log('Issues extracted from DOM:', issues);
              resolve({ success: true, issues });
            } else if (attempts >= maxAttempts) {
              clearInterval(checkInterval);
              reject(new Error('Timeout waiting for issues'));
            }
          }, 100);

          // Timeout after 10 seconds
          setTimeout(() => {
            clearInterval(checkInterval);
            console.error('Operation timed out after 10 seconds');
            reject(new Error('Timeout waiting for issues'));
          }, 10000);
        });

        console.log('Response received:', result);
        
        if (result.issues) {
          console.log('Updating issues in state:', result.issues);
          setIssues(result.issues);
        } else {
          console.warn('No issues found in result');
        }
        return result;
      }
      
      console.error('Action button not found in DOM');
      throw new Error('Action button not found');
    } catch (error) {
      console.error('Error in handleIssues:', {
        message: error.message,
        stack: error.stack,
        type: error.name
      });
      throw error;
    } finally {
      console.log('Resetting loading state');
      setIsLoading(prev => ({ ...prev, issues: false }));
      console.log('=== handleIssues completed ===');
    }
  }, [setIssues]);

  const removeIssue = useCallback((issueId) => {
    console.log('Removing issue:', issueId);
    setIssues(prev => prev.filter(issue => 
      typeof issue === 'string' ? issue !== issueId : issue.id !== issueId
    ));
  }, [setIssues]);

  return {
    serverHealth,
    guidelines,
    prompts,
    logs,
    handleIssues,
    isLoading,
    issues,
    removeIssue
  };
} 