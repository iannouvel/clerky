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
    if (!input.trim()) return;
    
    setIsLoading(prev => ({ ...prev, issues: true }));
    try {
      // Get the issues from the old implementation
      const issuesResponse = await window.handleAction(input);
      if (issuesResponse?.issues) {
        setIssues(issuesResponse.issues);
      }
      return issuesResponse;
    } catch (error) {
      console.error('Error processing issues:', error);
      throw error;
    } finally {
      setIsLoading(prev => ({ ...prev, issues: false }));
    }
  }, [setIssues]);

  const removeIssue = useCallback((issueId) => {
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