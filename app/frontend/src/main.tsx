import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';

// NO STATE LIBRARY (plan B2). Verified against the house reference: the CoreX console
// ships zero of zustand/redux/jotai/mobx/recoil/valtio. Server state lives in TanStack
// Query; anything genuinely client-side becomes a React context. Adding a store later is
// a decision, not a default.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
