import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { ToastProvider } from './components/ui.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PrefsProvider } from './context/PrefsContext.jsx';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (count, err) => count < 1 && !(err?.status >= 400 && err?.status < 500), staleTime: 15000 },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PrefsProvider>
          <ToastProvider>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
              <App />
            </BrowserRouter>
          </ToastProvider>
        </PrefsProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
