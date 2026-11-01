import type { CapacitorConfig } from '@capacitor/cli';

// Android app wrapper. The web build in `dist/` is bundled into the APK, so the app
// works fully offline and never loads code from the internet.
const config: CapacitorConfig = {
  appId: 'com.lin.novafinance',
  appName: 'Nova Finance',
  webDir: 'dist',
  backgroundColor: '#0b1220',
  android: {
    // Release builds must not be debuggable through Chrome DevTools.
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
