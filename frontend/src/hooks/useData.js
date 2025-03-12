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
    console.log('Current window.handleAction:', typeof window.handleAction);
    
    if (!input.trim()) {
      console.log('Empty input, returning early');
      return;
    }
    
    setIsLoading(prev => ({ ...prev, issues: true }));
    console.log('Loading state set to true');
    
    try {
      // Sync the input with the old implementation's summary div
      const summaryDiv = document.getElementById('summary');
      console.log('Looking for summary div:', { 
        found: !!summaryDiv,
        content: summaryDiv?.textContent,
        innerHTML: summaryDiv?.innerHTML
      });
      
      if (summaryDiv) {
        summaryDiv.textContent = input;
        // Force a reflow to ensure the content is updated
        void summaryDiv.offsetHeight;
        console.log('Updated summary div content:', {
          newContent: summaryDiv.textContent,
          length: summaryDiv.textContent.length
        });
      } else {
        throw new Error('Summary div not found in DOM');
      }

      // Try to call window.handleAction directly first
      if (typeof window.handleAction === 'function') {
        console.log('Attempting to call window.handleAction directly');
        try {
          const directResult = await window.handleAction();
          console.log('Direct handleAction result:', directResult);
          
          if (directResult && directResult.success && directResult.issues) {
            console.log('Successfully got issues from direct call:', directResult.issues);
            setIssues(directResult.issues);
            return directResult;
          } else {
            console.warn('Direct call returned invalid result:', directResult);
          }
        } catch (directError) {
          console.error('Error calling handleAction directly:', directError);
        }
      } else {
        console.warn('window.handleAction is not a function:', typeof window.handleAction);
      }

      // Fallback to button click if direct call fails
      const actionBtn = document.getElementById('actionBtn');
      console.log('Looking for action button:', { 
        found: !!actionBtn,
        disabled: actionBtn?.disabled,
        visible: actionBtn?.style.display !== 'none'
      });
      
      if (!actionBtn) {
        throw new Error('Action button not found in DOM');
      }

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
            childrenCount: suggestedGuidelinesDiv?.children.length || 0,
            innerHTML: suggestedGuidelinesDiv?.innerHTML?.substring(0, 100) // First 100 chars
          });
          
          if (suggestedGuidelinesDiv && suggestedGuidelinesDiv.children.length > 0) {
            clearInterval(checkInterval);
            const issueElements = suggestedGuidelinesDiv.querySelectorAll('.accordion-item h4');
            const issues = Array.from(issueElements)
              .map(h4 => h4.textContent.trim())
              .filter(Boolean);
            
            if (issues.length > 0) {
              console.log('Issues found:', issues);
              resolve({ success: true, issues });
            } else {
              console.warn('No issues found in DOM elements');
              reject(new Error('No issues found in DOM elements'));
            }
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error(`Timeout after ${attempts} attempts`));
          }
        }, 100);

        // Timeout after 10 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          const state = {
            summaryContent: summaryDiv?.textContent,
            guidelinesHTML: document.getElementById('suggestedGuidelines')?.innerHTML,
            actionButtonState: actionBtn ? {
              disabled: actionBtn.disabled,
              display: actionBtn.style.display,
              className: actionBtn.className
            } : 'not found'
          };
          console.error('Operation timed out after 10 seconds. State:', state);
          reject(new Error('Timeout waiting for issues'));
        }, 10000);
      });

      if (result.issues) {
        console.log('Setting issues in state:', result.issues);
        setIssues(result.issues);
      }
      return result;
    } catch (error) {
      console.error('Error in handleIssues:', {
        message: error.message,
        stack: error.stack,
        type: error.name,
        state: {
          summaryDivExists: !!document.getElementById('summary'),
          actionBtnExists: !!document.getElementById('actionBtn'),
          guidelinesDivExists: !!document.getElementById('suggestedGuidelines'),
          windowHandleAction: typeof window.handleAction
        }
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