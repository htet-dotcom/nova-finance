import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LockProvider } from './lock';
import { initServiceWorker } from './pwa';
import { StoreProvider } from './store';
import { ToastProvider } from './ui';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <ToastProvider>
        <LockProvider>
          <App />
        </LockProvider>
      </ToastProvider>
    </StoreProvider>
  </StrictMode>,
);

initServiceWorker();
