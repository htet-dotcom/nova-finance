import { readFileSync } from 'node:fs';
import type { Download, Page } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { addTx, expect, nav, open, test } from './fixtures';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

async function openReports(page: Page) {
  if (isMobile(page)) {
    await nav(page, 'dashboard');
    await page.getByTestId('open-reports').click();
  } else {
    await page.locator('.sidebar a[href="#/reports"]').click();
  }
  await expect(page.getByTestId('reports')).toBeVisible();
}

async function collectDownloads(page: Page, action: () => Promise<void>, count: number): Promise<Download[]> {
  const got: Download[] = [];
  const done = new Promise<void>((resolve) => {
    const h = (d: Download) => {
      got.push(d);
      if (got.length === count) {
        page.off('download', h);
        resolve();
      }
    };
    page.on('download', h);
  });
  await action();
  await done;
  return got;
}

function pngSize(buf: Buffer) {
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function pdfPages(path: string) {
  const bytes = new Uint8Array(readFileSync(path));
  expect(Buffer.from(bytes.subarray(0, 8)).toString('latin1')).toBe('%PDF-1.4');
  const doc = await getDocument({ data: bytes }).promise;
  return doc.numPages;
}

/** Fraction of dark pixels in a PNG rendered by the browser (guards against blank/tofu-only images). */
async function inkRatio(page: Page, buf: Buffer) {
  return page.evaluate(async (b64) => {
    // Decode locally (the app's CSP blocks fetch() of data: URLs).
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const img = await createImageBitmap(new Blob([bin], { type: 'image/png' }));
    const c = new OffscreenCanvas(img.width, img.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
    return dark / (d.length / 4);
  }, buf.toString('base64'));
}

async function seed(page: Page) {
  await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary', note: 'October pay' });
  await addTx(page, { amount: '120', category: 'cat_food', note: 'ထမင်းစား (lunch)' });
  await addTx(page, { amount: '80', category: 'cat_transport' });
}

test.describe('reports', () => {
  test('daily + monthly preview totals; empty report', async ({ page, errors }) => {
    await open(page);
    await seed(page);
    await openReports(page);
    await expect(page.getByTestId('report-income')).toHaveText('฿3,000');
    await expect(page.getByTestId('report-expense')).toHaveText('฿200');
    await expect(page.getByTestId('report-net')).toHaveText('฿2,800');
    await expect(page.getByTestId('report-count')).toContainText('3 transaction(s)');

    await page.getByTestId('report-date').fill('2020-01-15');
    await expect(page.getByTestId('report-income')).toHaveText('฿0');
    await expect(page.getByTestId('report-count')).toContainText('No transactions in this period');

    await page.getByTestId('report-kind-monthly').click();
    await expect(page.getByTestId('report-expense')).toHaveText('฿200');
    const year = await page.getByTestId('report-year').inputValue();
    await page.getByTestId('report-year').selectOption(String(Number(year) - 1));
    await expect(page.getByTestId('report-expense')).toHaveText('฿0');
    expect(errors).toEqual([]);
  });

  test('exports PDF, PNG and TXT with valid file types', async ({ page, errors }, info) => {
    await open(page);
    await seed(page);
    await openReports(page);

    await page.getByTestId('report-format-txt').click();
    const [txt] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    expect(txt.suggestedFilename()).toMatch(/^nova-finance-daily-\d{4}-\d{2}-\d{2}\.txt$/);
    const txtPath = info.outputPath('r.txt');
    await txt.saveAs(txtPath);
    const text = readFileSync(txtPath, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Total expense: ฿200');
    expect(text).toContain('ထမင်းစား (lunch)');
    await expect(page.getByTestId('report-status')).toHaveAttribute('data-state', 'done');

    await page.getByTestId('report-format-pdf').click();
    const [pdf] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const pdfPath = info.outputPath('r.pdf');
    await pdf.saveAs(pdfPath);
    expect(await pdfPages(pdfPath)).toBe(1);

    await page.getByTestId('report-format-png').click();
    const [png] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    expect(png.suggestedFilename()).toMatch(/\.png$/);
    const pngPath = info.outputPath('r.png');
    await png.saveAs(pngPath);
    const buf = readFileSync(pngPath);
    expect(pngSize(buf).width).toBe(1080);
    expect(await inkRatio(page, buf)).toBeGreaterThan(0.005);
    expect(errors).toEqual([]);
  });

  test('Myanmar report uses the bundled Myanmar font (not system fonts)', async ({ page }, info) => {
    const fontRequests: string[] = [];
    page.on('request', (r) => r.url().includes('noto-sans-myanmar') && fontRequests.push(r.url()));
    await open(page);
    await seed(page);
    await nav(page, 'settings');
    await page.getByTestId('lang-my').click();
    await openReports(page);
    await page.getByTestId('report-format-png').click();
    const [png] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    const p = info.outputPath('my.png');
    await png.saveAs(p);
    expect(fontRequests.some((u) => u.includes('myanmar-400'))).toBe(true);
    expect(fontRequests.every((u) => new URL(u).origin === new URL(page.url()).origin)).toBe(true);
    const loaded = await page.evaluate(() => document.fonts.check('700 24px "Nova Report"', 'မြန်မာ စာရင်းချုပ်'));
    expect(loaded).toBe(true);
    expect(await inkRatio(page, readFileSync(p))).toBeGreaterThan(0.005);

    await page.getByTestId('report-format-pdf').click();
    const [pdf] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    const pdfPath = info.outputPath('my.pdf');
    await pdf.saveAs(pdfPath);
    expect(await pdfPages(pdfPath)).toBe(1);

    await page.getByTestId('report-format-txt').click();
    const [txt] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    const tp = info.outputPath('my.txt');
    await txt.saveAs(tp);
    expect(readFileSync(tp, 'utf8')).toContain('နေ့စဉ် စာရင်း');
  });

  test('long monthly report paginates (PDF pages, multiple PNGs, full TXT)', async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page);
    // Build a 300-transaction backup from an exported one and import it.
    await nav(page, 'settings');
    const [dl] = await collectDownloads(page, () => page.getByTestId('export-json').click(), 1);
    const p = info.outputPath('base.json');
    await dl.saveAs(p);
    const backup = JSON.parse(readFileSync(p, 'utf8'));
    const today = new Date();
    const ym = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const now = new Date().toISOString();
    backup.data.transactions = Array.from({ length: 300 }, (_, i) => ({
      id: `bulk_${i}`,
      type: 'expense',
      amount: i + 1,
      currency: 'THB',
      categoryId: i % 2 ? 'cat_food' : 'cat_transport',
      date: `${ym}-01`,
      note: `Item ${i + 1} မှတ်ချက်`,
      recurring: null,
      createdAt: now,
      updatedAt: now,
    }));
    await page.getByTestId('import-file').setInputFiles({ name: 'bulk.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByTestId('import-replace').click();
    await page.getByTestId('import-confirm').click();
    await openReports(page);
    await page.getByTestId('report-kind-monthly').click();
    await expect(page.getByTestId('report-count')).toContainText('300 transaction(s)');
    await expect(page.getByTestId('report-expense')).toHaveText('฿45,150'); // 1+2+…+300

    await page.getByTestId('report-format-pdf').click();
    const [pdf] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    const pdfPath = info.outputPath('long.pdf');
    await pdf.saveAs(pdfPath);
    expect(await pdfPages(pdfPath)).toBeGreaterThan(5);

    await page.getByTestId('report-format-png').click();
    await page.getByTestId('report-export').click();
    await expect(page.getByTestId('report-status')).toHaveAttribute('data-state', 'done', { timeout: 60_000 });
    const n = Number(/\((\d+) files\)/.exec(await page.getByTestId('report-status').innerText())![1]);
    expect(n).toBeGreaterThan(5);

    await page.getByTestId('report-format-txt').click();
    const [txt] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
    const tp = info.outputPath('long.txt');
    await txt.saveAs(tp);
    const text = readFileSync(tp, 'utf8');
    for (const i of [1, 150, 300]) expect(text).toContain(`Item ${i} မှတ်ချက်`);
    expect(text.match(/^• /gm)).toHaveLength(300);
  });

  test('native file share: shares actual files; cancel is reported as cancel', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: { names: string[]; types: string[] }[]; __mode: string };
      w.__shared = [];
      w.__mode = 'ok';
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: ShareData) => !!d.files?.length });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: ShareData) => {
          if (w.__mode === 'cancel') throw new DOMException('cancelled', 'AbortError');
          w.__shared.push({ names: (d.files ?? []).map((f) => f.name), types: (d.files ?? []).map((f) => f.type) });
        },
      });
    });
    await open(page);
    await seed(page);
    await openReports(page);
    for (const [fmt, type] of [['pdf', 'application/pdf'], ['png', 'image/png'], ['txt', 'text/plain;charset=utf-8']] as const) {
      await page.getByTestId(`report-format-${fmt}`).click();
      await page.getByTestId('report-share').click();
      await expect(page.getByTestId('report-status')).toHaveAttribute('data-state', 'done');
      await expect(page.getByTestId('report-status')).toContainText('Share completed');
      const last = await page.evaluate(() => (window as unknown as { __shared: { names: string[]; types: string[] }[] }).__shared.at(-1)!);
      expect(last.types[0]).toBe(type);
      expect(last.names[0]).toMatch(new RegExp(`\\.${fmt}$`));
    }
    await page.evaluate(() => ((window as unknown as { __mode: string }).__mode = 'cancel'));
    await page.getByTestId('report-share').click();
    await expect(page.getByTestId('report-status')).toHaveAttribute('data-state', 'cancelled');
    await expect(page.getByTestId('report-status')).toContainText('nothing was sent');
  });

  test('unsupported file sharing: downloads the file and offers text share/copy', async ({ page, context, browserName }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false });
    });
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await seed(page);
    await openReports(page);
    const [d] = await collectDownloads(page, () => page.getByTestId('report-share').click(), 1);
    expect(d.suggestedFilename()).toMatch(/\.pdf$/);
    await expect(page.getByTestId('report-status')).toHaveAttribute('data-state', 'fallback');
    await expect(page.getByTestId('report-text-fallback')).toBeVisible();
    await page.getByTestId('report-copy-text').click();
    await expect(page.getByText('Copied to clipboard')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('Total expense: ฿200');
  });

  test('works offline: export all formats and share fallback without network', async ({ page, context }) => {
    await open(page);
    await page.evaluate(async () => void (await navigator.serviceWorker.ready));
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('offline-bar')).toBeVisible();
    await seed(page);
    await openReports(page);
    for (const fmt of ['pdf', 'png', 'txt']) {
      await page.getByTestId(`report-format-${fmt}`).click();
      const [d] = await collectDownloads(page, () => page.getByTestId('report-export').click(), 1);
      expect(d.suggestedFilename()).toMatch(new RegExp(`\\.${fmt}$`));
    }
    await context.setOffline(false);
  });
});
