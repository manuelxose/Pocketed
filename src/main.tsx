import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './index.css';
import { queryClient } from './lib/queryClient';
import { wsUrl } from './lib/ws-client';
import { AuthGate } from './state/AuthGate';
import { WsProvider } from './state/WsProvider';
import { ToastProvider } from './state/ToastProvider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        <ToastProvider>
          <WsProvider url={wsUrl()}>
            <App />
          </WsProvider>
        </ToastProvider>
      </AuthGate>
    </QueryClientProvider>
  </React.StrictMode>,
);
