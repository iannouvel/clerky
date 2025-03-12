import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../services/api';
import useStore from '../stores/useStore';

export const useData = () => {
  const {
    setGuidelines,
    setPrompts,
    setLogs,
    setServerStatus,
    user,
  } = useStore();

  // Server health check
  const { data: serverHealth } = useQuery({
    queryKey: ['serverHealth'],
    queryFn: api.checkServerHealth,
    refetchInterval: 30000, // Check every 30 seconds
    onSuccess: (isHealthy) => {
      setServerStatus(isHealthy ? 'live' : 'down');
    },
  });

  // Guidelines
  const { data: guidelines, isLoading: isLoadingGuidelines } = useQuery({
    queryKey: ['guidelines'],
    queryFn: api.fetchGuidelines,
    onSuccess: (data) => {
      setGuidelines(data);
    },
  });

  // Prompts
  const { data: prompts, isLoading: isLoadingPrompts } = useQuery({
    queryKey: ['prompts'],
    queryFn: api.fetchPrompts,
    onSuccess: (data) => {
      setPrompts(data);
    },
  });

  // Logs
  const { data: logs, isLoading: isLoadingLogs } = useQuery({
    queryKey: ['logs'],
    queryFn: api.fetchLogs,
    onSuccess: (data) => {
      setLogs(data);
    },
  });

  // Handle clinical issues mutation
  const { mutate: handleIssues, isLoading: isHandlingIssues } = useMutation({
    mutationFn: (prompt) => api.handleIssues(prompt, user?.token),
  });

  return {
    serverHealth,
    guidelines,
    prompts,
    logs,
    handleIssues,
    isLoading: {
      guidelines: isLoadingGuidelines,
      prompts: isLoadingPrompts,
      logs: isLoadingLogs,
      issues: isHandlingIssues,
    },
  };
}; 