// Renders the source images @capacitor/assets needs (assets/*.png) from the app logo,
// then run: npx @capacitor/assets generate --android
// Usage: node scripts/gen-native-assets.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (f) => fileURLToPath(new URL(`../assets/${f}`, import.meta.url));
mkdirSync(fileURLToPath(new URL('../assets/', import.meta.url)), { recursive: true });

const gradient = 'linear-gradient(135deg, #14b8a6, #0f766e)';
// The logo without its rounded-square background: ring, progress arc and "N".
const mark = (stroke = '#ffffff') => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <circle cx="256" cy="256" r="150" fill="none" stroke="${stroke}" stroke-opacity=".25" stroke-width="36"/>
  <path d="M256 106a150 150 0 0 1 141 99" fill="none" stroke="${stroke}" stroke-width="36" stroke-linecap="round"/>
  <text x="256" y="300" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="150" font-weight="800" fill="${stroke}">N</text>
</svg>`;

const targets = [
  // Legacy / round icon: full-bleed gradient with the mark (the launcher applies its own mask).
  { file: 'icon-only.png', size: 1024, bg: gradient, markSize: 0.62 },
  // Adaptive icon: Android shows only the central ~66%, so the mark stays inside it.
  { file: 'icon-foreground.png', size: 1024, bg: 'transparent', markSize: 0.5 },
  { file: 'icon-background.png', size: 1024, bg: gradient, markSize: 0 },
  // Splash: small logo tile on the app background.
  { file: 'splash.png', size: 2732, bg: '#f4f6f8', markSize: 0.16, tile: true },
  { file: 'splash-dark.png', size: 2732, bg: '#0b1220', markSize: 0.16, tile: true },
];

const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * t.markSize);
  const content = !inner
    ? ''
    : t.tile
      ? `<div style="width:${inner}px;height:${inner}px;border-radius:22%;background:${gradient};display:grid;place-items:center"><div style="width:80%;height:80%">${mark()}</div></div>`
      : `<div style="width:${inner}px;height:${inner}px">${mark()}</div>`;
  await page.setContent(
    `<html><body style="margin:0;background:${t.bg};display:grid;place-items:center;width:${t.size}px;height:${t.size}px">${content}</body></html>`,
  );
  await page.screenshot({ path: out(t.file), omitBackground: t.bg === 'transparent' });
  console.log('wrote assets/' + t.file);
}
await browser.close();
