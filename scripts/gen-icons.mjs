// Renders public/favicon.svg into the PNG icons the manifest needs.
// Usage: node scripts/gen-icons.mjs   (uses Playwright's Chromium or the local Chrome)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pub = (f) => fileURLToPath(new URL(`../public/${f}`, import.meta.url));
const svg = readFileSync(pub('favicon.svg'), 'utf8');
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const targets = [
  { file: 'pwa-192.png', size: 192, pad: 0, bg: 'transparent' },
  { file: 'pwa-512.png', size: 512, pad: 0, bg: 'transparent' },
  // Maskable: full-bleed background, logo inside the 80% safe zone.
  { file: 'pwa-maskable-512.png', size: 512, pad: 0.12, bg: '#0f766e' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.06, bg: '#0f766e' },
];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg};display:grid;place-items:center;width:${t.size}px;height:${t.size}px">` +
      `<img src="${dataUrl}" width="${inner}" height="${inner}"></body></html>`,
  );
  await page.screenshot({ path: pub(t.file), omitBackground: t.bg === 'transparent' });
  console.log('wrote', t.file);
}
await browser.close();
