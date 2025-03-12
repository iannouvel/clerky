import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './components/auth/AuthProvider'
import { LoginPage } from './components/auth/LoginPage'
import { TopBar } from './components/navigation/TopBar'
import { TabView } from './components/tabs/TabView'
import useStore from './stores/useStore'
import './App.css'

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
      cacheTime: 1000 * 60 * 30, // Keep unused data in cache for 30 minutes
    },
  },
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MainContent />
      </AuthProvider>
    </QueryClientProvider>
  )
}

function MainContent() {
  const user = useStore((state) => state.user)

  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="app">
      <TopBar />
      <main className="mainContent">
        <TabView />
      </main>
    </div>
  )
}

export default App
