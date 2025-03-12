import { useState, useCallback, useEffect } from 'react';
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

  // Add effect to initialize legacy code integration
  useEffect(() => {
    // Create a custom event for communication
    const processCompleteEvent = new Event('processComplete');
    
    // Store the original handleAction
    const originalHandleAction = window.handleAction;
    
    // Override window.handleAction to capture its results
    window.handleAction = async function() {
      console.log('Legacy handleAction called');
      try {
        if (originalHandleAction) {
          const result = await originalHandleAction();
          console.log('Legacy handleAction result:', result);
          
          // Dispatch event with the result
          window.processResult = result;
          document.dispatchEvent(processCompleteEvent);
          
          return result;
        }
        throw new Error('Original handleAction not found');
      } catch (error) {
        console.error('Error in legacy handleAction:', error);
        throw error;
      }
    };

    return () => {
      // Cleanup: restore original handleAction
      window.handleAction = originalHandleAction;
    };
  }, []);

  const handleIssues = useCallback(async (input) => {
    console.log('=== handleIssues started ===');
    console.log('Input received:', input);
    
    if (!input.trim()) {
      console.log('Empty input, returning early');
      return;
    }
    
    setIsLoading(prev => ({ ...prev, issues: true }));
    
    try {
      // Update the summary div
      const summaryDiv = document.getElementById('summary');
      if (!summaryDiv) {
        throw new Error('Summary div not found');
      }
      
      // Update content and force reflow
      summaryDiv.textContent = input;
      void summaryDiv.offsetHeight;
      
      // Create a promise that will resolve when processing is complete
      const processPromise = new Promise((resolve, reject) => {
        // Set up one-time event listener for process completion
        const handleProcessComplete = () => {
          const result = window.processResult;
          console.log('Process complete event received, result:', result);
          if (result && result.success && Array.isArray(result.issues)) {
            resolve(result);
          } else {
            reject(new Error('Invalid process result'));
          }
        };
        
        // Listen for the completion event
        document.addEventListener('processComplete', handleProcessComplete, { once: true });
        
        // Set timeout for the operation
        setTimeout(() => {
          document.removeEventListener('processComplete', handleProcessComplete);
          reject(new Error('Process timeout'));
        }, 10000);
        
        // Trigger the process
        console.log('Triggering process...');
        const actionBtn = document.getElementById('actionBtn');
        if (actionBtn) {
          actionBtn.click();
        } else {
          reject(new Error('Action button not found'));
        }
      });

      // Wait for the process to complete
      const result = await processPromise;
      console.log('Process completed successfully:', result);
      
      // Update state with the results
      if (result.issues && Array.isArray(result.issues)) {
        console.log('Setting issues in state:', result.issues);
        setIssues(result.issues);
        
        // Call displayIssues function from the legacy code
        if (window.displayIssues && window.getPrompts) {
          console.log('Calling legacy displayIssues...');
          const prompts = await window.getPrompts();
          await window.displayIssues(result.issues, prompts);
        }
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
          windowHandleAction: typeof window.handleAction
        }
      });
      throw error;
    } finally {
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