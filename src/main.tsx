import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { queryClient } from './lib/queryClient';
import { wsUrl } from './lib/ws-client';
import { AuthGate } from './state/AuthGate';
import { WsProvider } from './state/WsProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <WsProvider url={wsUrl()}>
          <App />
        </WsProvider>
      </AuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
