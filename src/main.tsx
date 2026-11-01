import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { LockProvider } from './lock';
import { initBackButton, isNative } from './native';
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

// The Android app ships its files inside the APK: no service worker needed there.
if (isNative) void initBackButton();
else initServiceWorker();
