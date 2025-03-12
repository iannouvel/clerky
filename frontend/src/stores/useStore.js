import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useStore = create(
  persist(
    (set, get) => ({
      // Authentication state
      user: null,
      setUser: (user) => set({ user }),

      // Guidelines data
      guidelines: [],
      guidanceDataLoaded: false,
      setGuidelines: (guidelines) => set({ guidelines, guidanceDataLoaded: true }),

      // Prompts data
      prompts: {},
      setPrompts: (prompts) => set({ prompts }),

      // Logs data
      logs: [],
      currentLogIndex: 0,
      setLogs: (logs) => set({ logs }),
      setCurrentLogIndex: (index) => set({ currentLogIndex: index }),

      // Server status
      serverStatus: 'unknown',
      setServerStatus: (status) => set({ serverStatus: status }),

      // Cache clearing
      clearCache: () => {
        const user = get().user; // Preserve user auth
        set({
          guidelines: [],
          guidanceDataLoaded: false,
          prompts: {},
          logs: [],
          currentLogIndex: 0,
          serverStatus: 'unknown',
          user
        });
      },
    }),
    {
      name: 'clerky-storage',
      partialize: (state) => ({
        user: state.user,
        guidelines: state.guidelines,
        prompts: state.prompts,
      }),
    }
  )
); 