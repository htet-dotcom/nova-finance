import { defineConfig, devices } from '@playwright/test';

// PROD_URL=https://…/ npm run e2e  → runs the same suite against the deployed site.
const prod = process.env.PROD_URL;
const baseURL = prod ?? 'http://localhost:4173/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: prod ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
    acceptDownloads: true,
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: prod
    ? undefined
    : {
        command: 'npm run build && npm run preview',
        url: 'http://localhost:4173/',
        reuseExistingServer: true,
        timeout: 180_000,
      },
});
