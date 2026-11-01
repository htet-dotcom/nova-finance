// Native (Android app) integration. On the web every function here is a no-op or
// falls back to browser APIs, so one codebase serves both the PWA and the APK.
// Native plugins are loaded lazily so they never weigh down the web bundle.

import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

// ---------------------------------------------------------------------------
// Files: save & share
// ---------------------------------------------------------------------------

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) s += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  return btoa(s);
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_');

/** Write a file to the app cache and return its native URI (for the share sheet). */
async function cacheFile(file: Blob, name: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const res = await Filesystem.writeFile({ path: `share/${safeName(name)}`, data: await blobToBase64(file), directory: Directory.Cache, recursive: true });
  return res.uri;
}

/**
 * Save a file where the user can find it: Documents/NovaFinance on the device.
 * Returns the folder path shown to the user, or null when the device refused
 * (callers then offer the share sheet so the user can choose a destination).
 */
export async function nativeSaveFile(file: Blob, name: string): Promise<string | null> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  try {
    await Filesystem.writeFile({ path: `NovaFinance/${safeName(name)}`, data: await blobToBase64(file), directory: Directory.Documents, recursive: true });
    return 'Documents/NovaFinance';
  } catch (e) {
    console.warn('Saving to Documents failed', e);
    return null;
  }
}

function isCancel(e: unknown): boolean {
  return /cancel/i.test(String((e as Error)?.message ?? e));
}

/** A navigator.share-compatible function backed by the native share sheet. */
export async function nativeShare(data: ShareData): Promise<void> {
  const { Share } = await import('@capacitor/share');
  try {
    const files = data.files?.length ? await Promise.all(data.files.map((f) => cacheFile(f, f.name))) : undefined;
    await Share.share({ title: data.title, text: data.text, url: data.url, files, dialogTitle: data.title });
  } catch (e) {
    // Normalise to the Web Share API error names the UI already understands.
    throw new DOMException(String((e as Error)?.message ?? e), isCancel(e) ? 'AbortError' : 'DataError');
  }
}

/** Open an external link (Telegram, …) outside the app. */
export function openExternal(url: string) {
  if (isNative) window.location.href = url;
  else window.open(url, '_blank', 'noopener,noreferrer');
}

// ---------------------------------------------------------------------------
// Biometrics
// ---------------------------------------------------------------------------

export async function nativeBiometricAvailable(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

export async function nativeBiometricVerify(reason: string): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.checkBiometry();
    await BiometricAuth.authenticate({ reason, androidTitle: 'Nova Finance', androidSubtitle: reason, allowDeviceCredential: false, cancelTitle: '✕' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// App lifecycle, back button, system bars
// ---------------------------------------------------------------------------

/** Called when the app goes to the background (false) or comes back (true). */
export async function onAppActive(cb: (active: boolean) => void): Promise<() => void> {
  if (!isNative) return () => {};
  const { App } = await import('@capacitor/app');
  const h = await App.addListener('appStateChange', ({ isActive }) => cb(isActive));
  return () => void h.remove();
}

/**
 * Android back button: close the top sheet, else go back in the app, else leave the app.
 * Sheets already close on Escape, so we reuse that.
 */
export async function initBackButton() {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', () => {
    if (document.querySelector('.sheet')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    const route = window.location.hash.replace(/^#\/?/, '');
    if (route && route !== 'dashboard' && !document.querySelector('[data-testid=lock-screen]')) window.location.hash = '/dashboard';
    else void App.minimizeApp();
  });
}

export async function setSystemBarsDark(dark: boolean) {
  if (!isNative) return;
  try {
    const { SystemBars, SystemBarsStyle } = await import('@capacitor/core');
    await SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light });
  } catch {
    /* older WebView / plugin unavailable: cosmetic only */
  }
}
