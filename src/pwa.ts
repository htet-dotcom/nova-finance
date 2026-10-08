import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

export function useInstallPrompt() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return {
    available: !!deferred,
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferred = null;
      notify();
    },
  };
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

type SwState = { needRefresh: boolean; offlineReady: boolean };
let swState: SwState = { needRefresh: false, offlineReady: false };
let updateSW: ((reload?: boolean) => Promise<void>) | null = null;
const swListeners = new Set<() => void>();

export function initServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      swState = { ...swState, needRefresh: true };
      swListeners.forEach((l) => l());
    },
    onOfflineReady() {
      swState = { ...swState, offlineReady: true };
      swListeners.forEach((l) => l());
    },
    onRegisteredSW(_url, reg) {
      // Check for updates hourly while the app stays open.
      if (reg) window.setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });
}

export function useServiceWorker() {
  const [state, setState] = useState(swState);
  useEffect(() => {
    const l = () => setState(swState);
    swListeners.add(l);
    return () => void swListeners.delete(l);
  }, []);
  return {
    ...state,
    update: () => updateSW?.(true),
    dismissOfflineReady: () => {
      swState = { ...swState, offlineReady: false };
      setState(swState);
    },
  };
}
