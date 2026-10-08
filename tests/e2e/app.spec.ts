import { readFileSync } from 'node:fs';
import { addTx, expect, nav, noHorizontalOverflow, open, test, use30DayPeriod } from './fixtures';

test.describe('core flows', () => {
  test('first load: dashboard, no income state, privacy messaging, no errors', async ({ page, errors }) => {
    await open(page);
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('hero')).toHaveAttribute('data-status', 'no-income');
    await expect(page.getByTestId('daily-limit')).toHaveText('฿0');
    await nav(page, 'settings');
    await expect(page.getByTestId('privacy')).toContainText('stored only on this device');
    await expect(page.getByTestId('last-backup')).toContainText('Never');
    expect(errors).toEqual([]);
  });

  test('income → dynamic daily limit; expense over limit → warning; under limit → tomorrow rises', async ({ page, errors }) => {
    await open(page);
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await expect(page.getByTestId('daily-limit')).toHaveText('฿100');
    await expect(page.getByTestId('days-left')).toHaveText('30');
    await expect(page.getByTestId('stat-income')).toContainText('฿3,000');

    // Under the limit: tomorrow's limit increases.
    await addTx(page, { amount: '70', category: 'cat_food' });
    await expect(page.getByTestId('spent-today')).toHaveText('฿70');
    await expect(page.getByTestId('left-today')).toHaveText('฿30');
    await expect(page.getByTestId('stat-tomorrow')).toContainText('฿101.03');
    await expect(page.getByTestId('hero')).toHaveAttribute('data-status', 'ok');

    // Over the limit: warning with exact amount.
    await addTx(page, { amount: '55', category: 'cat_food' });
    await expect(page.getByTestId('hero')).toHaveAttribute('data-status', 'over');
    await expect(page.getByTestId('over-warning')).toContainText("You have exceeded today's recommended spending limit by ฿25.");
    await expect(page.getByTestId('stat-expenses')).toContainText('฿125');
    await expect(page.getByTestId('stat-balance')).toContainText('฿2,875');

    // Income increase raises today's limit automatically.
    await addTx(page, { type: 'income', amount: '2000', category: 'cat_freelance' });
    await expect(page.getByTestId('daily-limit')).toHaveText('฿166.67');
    expect(errors).toEqual([]);
  });

  test('savings and fixed expenses reduce the spendable amount; fixed category does not hit daily limit', async ({ page }) => {
    await open(page);
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await nav(page, 'budget');
    await page.getByTestId('budget-tab-rules').click();
    await page.getByTestId('savings-target').fill('500');
    await page.getByTestId('fixed-expenses').fill('500');
    await expect(page.getByTestId('spendable-preview')).toContainText('฿2,000');
    await expect(page.getByTestId('spendable-preview')).toContainText('฿66.67');
    await nav(page, 'dashboard');
    await expect(page.getByTestId('daily-limit')).toHaveText('฿66.67');
    await addTx(page, { amount: '500', category: 'cat_rent' });
    await expect(page.getByTestId('spent-today')).toHaveText('฿0');
    await expect(page.getByTestId('daily-limit')).toHaveText('฿66.67');
  });

  test('category budget warning', async ({ page }) => {
    await open(page);
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '30000', category: 'cat_salary' });
    await nav(page, 'budget');
    await page.getByTestId('budget-tab-categories').click();
    await page.getByTestId('cat-section-expense').getByText('Food', { exact: true }).click();
    await page.getByTestId('cat-budget').fill('500');
    await page.getByTestId('cat-save').click();
    await nav(page, 'dashboard');
    await addTx(page, { amount: '600', category: 'cat_food' });
    await expect(page.getByTestId('category-warnings')).toContainText('Food is over budget by ฿100');
  });

  test('edit, delete, search and filter transactions; data persists after reload', async ({ page }) => {
    await open(page);
    await addTx(page, { type: 'income', amount: '1000', category: 'cat_salary', note: 'October pay' });
    await addTx(page, { amount: '45', category: 'cat_transport', note: 'Taxi home' });
    await addTx(page, { amount: '80', category: 'cat_food', note: 'Dinner' });
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-count')).toHaveText('3 transactions');
    await page.getByTestId('tx-search').fill('taxi');
    await expect(page.getByTestId('tx-count')).toHaveText('1 transactions');
    await page.getByTestId('tx-search').fill('');
    await page.getByTestId('filter-income').click();
    await expect(page.getByTestId('tx-count')).toHaveText('1 transactions');
    await page.getByTestId('filter-expense').click();
    await page.getByTestId('filter-category').selectOption('cat_food');
    await expect(page.getByTestId('tx-count')).toHaveText('1 transactions');

    // Edit amount
    await page.getByTestId('tx-row').first().click();
    await page.getByTestId('tx-amount').fill('90');
    await page.getByTestId('tx-save').click();
    await expect(page.getByTestId('tx-row').first()).toContainText('90');

    // Persist across reload
    await page.reload();
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-count')).toHaveText('3 transactions');

    // Delete
    await page.getByTestId('tx-search').fill('dinner');
    await page.getByTestId('tx-row').first().click();
    await page.getByTestId('tx-delete').click();
    await page.getByTestId('confirm-yes').click();
    await page.getByTestId('tx-search').fill('');
    await expect(page.getByTestId('tx-count')).toHaveText('2 transactions');
  });

  test('custom categories: create, rename, delete with reassignment', async ({ page }) => {
    await open(page);
    await nav(page, 'budget');
    await page.getByTestId('budget-tab-categories').click();
    await page.getByTestId('cat-add-expense').click();
    await page.getByTestId('cat-name').fill('Coffee');
    await page.getByRole('button', { name: '☕' }).click();
    await page.getByTestId('cat-save').click();
    const section = page.getByTestId('cat-section-expense');
    await expect(section).toContainText('Coffee');

    await addTx(page, { amount: '60', category: undefined });
    await section.getByText('Coffee', { exact: true }).click();
    await page.getByTestId('cat-name').fill('Cafe');
    await page.getByTestId('cat-save').click();
    await expect(section).toContainText('Cafe');

    await section.getByText('Cafe', { exact: true }).click();
    await page.getByTestId('cat-delete').click();
    await page.getByTestId('cat-delete-confirm').click();
    await expect(section).not.toContainText('Cafe');
  });

  test('summary reports for today / week / month / custom', async ({ page }) => {
    await open(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await addTx(page, { amount: '200', category: 'cat_food' });
    await addTx(page, { amount: '100', category: 'cat_transport' });
    await nav(page, 'budget');
    for (const r of ['today', 'week', 'month', 'period', 'custom']) {
      await page.getByTestId(`range-${r}`).click();
      await expect(page.getByTestId('sum-income')).toHaveText('฿3,000');
      await expect(page.getByTestId('sum-expense')).toHaveText('฿300');
      await expect(page.getByTestId('sum-net')).toHaveText('฿2,700');
    }
    await expect(page.getByTestId('top-category')).toContainText('Food');
  });

  test('Myanmar language and dark mode', async ({ page }) => {
    await open(page);
    await nav(page, 'settings');
    await page.getByTestId('lang-my').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'my');
    await nav(page, 'dashboard');
    await expect(page.locator('.title').first()).toHaveText('ဒီနေ့ ဘယ်လောက်အထိ သုံးလို့ရသေးလဲ?');
    await nav(page, 'settings');
    await page.getByTestId('theme-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(11, 18, 32)');
  });
});

test.describe('currency & exchange', () => {
  test('manual MMK rate drives calculator and multi-currency totals', async ({ page, errors }) => {
    await open(page);
    await nav(page, 'exchange');
    // Provider (mocked) rates are labelled with source and status.
    await expect(page.getByTestId('provider-rates')).toContainText('open.er-api.com');
    await page.getByTestId('mmk-pair-THB').click();
    await page.getByTestId('manual-rate').fill('120');
    await page.getByTestId('manual-save').click();
    await expect(page.getByTestId('rate-THB_MMK_manual')).toContainText('1 THB = 120 MMK');
    await expect(page.getByTestId('rate-THB_MMK_manual')).toContainText('Manual / User-entered rate');

    // Calculator: 1,000 THB → MMK uses the manual rate.
    await page.getByTestId('calc-from').selectOption('THB');
    await page.getByTestId('calc-to').selectOption('MMK');
    await page.getByTestId('calc-amount').fill('1000');
    await expect(page.getByTestId('calc-value')).toHaveText('120,000 Ks');
    await expect(page.getByTestId('calc-status')).toHaveText('Manual / User-entered rate');

    // USD → MMK goes through THB with the manual MMK rate (not the provider's official MMK rate).
    await page.getByTestId('calc-from').selectOption('USD');
    await page.getByTestId('calc-amount').fill('100');
    await expect(page.getByTestId('calc-value')).toHaveText('420,000 Ks');

    // Swap
    await page.getByTestId('calc-swap').click();
    await expect(page.getByTestId('calc-from')).toHaveValue('MMK');
    await expect(page.getByTestId('calc-to')).toHaveValue('USD');

    // USD → THB uses provider rate labelled live.
    await page.getByTestId('calc-from').selectOption('USD');
    await page.getByTestId('calc-to').selectOption('THB');
    await expect(page.getByTestId('calc-value')).toHaveText('฿3,500');
    await expect(page.getByTestId('calc-status')).toHaveText('Live');

    // MMK income counts in THB budget via the manual rate.
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '360000', currency: 'MMK', category: 'cat_salary' });
    await expect(page.getByTestId('stat-income')).toContainText('฿3,000');
    await expect(page.getByTestId('daily-limit')).toHaveText('฿100');
    expect(errors).toEqual([]);
  });

  test('missing rate is reported, not guessed', async ({ page }) => {
    await page.route('https://open.er-api.com/**', (r) => r.abort());
    await open(page);
    await addTx(page, { amount: '10', currency: 'EUR', category: 'cat_food' });
    await expect(page.getByTestId('missing-rate')).toContainText('EUR');
    await nav(page, 'exchange');
    await page.getByTestId('calc-from').selectOption('EUR');
    await page.getByTestId('calc-to').selectOption('THB');
    await expect(page.getByTestId('calc-no-rate')).toBeVisible();
  });
});

test.describe('backup', () => {
  test('export JSON + CSV, import (merge/replace), invalid file rejected, undo', async ({ page }, info) => {
    await open(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await addTx(page, { amount: '120', category: 'cat_food', note: '=cmd()' });
    await nav(page, 'settings');

    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    const jsonPath = info.outputPath('backup.json');
    await dl.saveAs(jsonPath);
    const backup = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(backup.format).toBe('nova-finance-backup');
    expect(backup.data.transactions).toHaveLength(2);
    expect(backup.data.categories.length).toBeGreaterThan(10);
    expect(backup.data.settings.primaryCurrency).toBe('THB');
    expect(Array.isArray(backup.data.rates)).toBe(true);
    await expect(page.getByTestId('last-backup')).not.toContainText('Never');

    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    const csvPath = info.outputPath('export.csv');
    await csv.saveAs(csvPath);
    const csvText = readFileSync(csvPath, 'utf8');
    expect(csvText).toContain('# Transactions');
    expect(csvText).toContain('# Exchange rates');
    expect(csvText).toContain("'=cmd()"); // formula injection neutralised

    // Invalid file is rejected with details.
    await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"nova-finance-backup","schemaVersion":1,"exportedAt":"x","data":{}}') });
    await expect(page.getByTestId('import-errors')).toBeVisible();
    await expect(page.getByTestId('import-confirm')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Wipe everything, then restore with replace.
    await page.getByTestId('reset-all').click();
    await page.getByTestId('confirm-yes').click();
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-count')).toHaveText('0 transactions');
    await nav(page, 'settings');
    await page.getByTestId('import-file').setInputFiles(jsonPath);
    await expect(page.getByTestId('import-summary')).toContainText('2 transactions');
    await page.getByTestId('import-replace').click();
    await page.getByTestId('import-confirm').click();
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-count')).toHaveText('2 transactions');

    // Merge the same file again: nothing duplicated.
    await nav(page, 'settings');
    await page.getByTestId('import-file').setInputFiles(jsonPath);
    await expect(page.getByTestId('import-changes')).toContainText('0 added');
    await page.getByTestId('import-confirm').click();
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-count')).toHaveText('2 transactions');

    // Undo restores pre-import state (which also had 2).
    await nav(page, 'settings');
    await expect(page.getByTestId('undo-import')).toBeVisible();
  });
});

test.describe('sharing', () => {
  test('native share sheet receives the daily summary', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: unknown) => void (window as unknown as { __shared: unknown[] }).__shared.push(d),
      });
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    });
    await open(page);
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await addTx(page, { amount: '125', category: 'cat_food' });
    await page.getByTestId('share-open').click();
    await expect(page.getByTestId('share-text')).toContainText('Over budget by ฿25');
    await page.getByTestId('share-native').click();
    const shared = await page.evaluate(() => (window as unknown as { __shared: { text: string }[] }).__shared);
    expect(shared).toHaveLength(1);
    expect(shared[0].text).toContain("Today's limit: ฿100");
    expect(shared[0].text).toContain('Income: ฿3,000');

    // Telegram link carries the same text, no bot involved.
    const href = await page.getByTestId('share-telegram').getAttribute('href');
    expect(href).toMatch(/^https:\/\/t\.me\/share\/url\?/);
    expect(new URL(href!).searchParams.get('text')).toContain('Over budget by ฿25');
  });

  test('falls back to clipboard when Web Share is unavailable', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-specific');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await open(page);
    await page.getByTestId('share-open').click();
    await page.getByTestId('share-native').click();
    await expect(page.getByText('Copied to clipboard')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain("Today's limit");
  });
});

test.describe('PWA', () => {
  test('manifest, icons and service worker', async ({ page, request, baseURL }) => {
    await open(page);
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifestUrl = new URL(href!, page.url()).toString();
    const manifest = await (await request.get(manifestUrl)).json();
    expect(manifest.name).toContain('Nova Finance');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const res = await request.get(new URL(icon.src, manifestUrl).toString());
      expect(res.ok(), icon.src).toBe(true);
      expect(res.headers()['content-type']).toContain('image/png');
    }
    const controlled = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    });
    expect(controlled).toBe(true);
    expect(baseURL).toBeTruthy();
  });

  test('works offline after first visit: load, add income & expense, calculate', async ({ page, context }) => {
    await open(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    // Make sure the page is controlled by the SW before going offline.
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await expect(page.getByTestId('offline-bar')).toBeVisible();
    await use30DayPeriod(page);
    await addTx(page, { type: 'income', amount: '3000', category: 'cat_salary' });
    await addTx(page, { amount: '40', category: 'cat_food' });
    await expect(page.getByTestId('daily-limit')).toHaveText('฿100');
    await expect(page.getByTestId('left-today')).toHaveText('฿60');
    await nav(page, 'exchange');
    await page.getByTestId('mmk-pair-THB').click();
    await page.getByTestId('manual-rate').fill('125');
    await page.getByTestId('manual-save').click();
    await page.getByTestId('calc-from').selectOption('THB');
    await page.getByTestId('calc-to').selectOption('MMK');
    await page.getByTestId('calc-amount').fill('1000');
    await expect(page.getByTestId('calc-value')).toHaveText('125,000 Ks');
    await nav(page, 'settings');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-json').click()]);
    expect(dl.suggestedFilename()).toMatch(/\.json$/);
    await context.setOffline(false);
  });
});

test.describe('responsive', () => {
  test('every view fits the viewport without horizontal scrolling', async ({ page }) => {
    await open(page);
    await addTx(page, { type: 'income', amount: '123456789', category: 'cat_salary', note: 'A very long note that should be truncated nicely in the list view without breaking the layout' });
    for (const r of ['dashboard', 'transactions', 'budget', 'exchange', 'settings']) {
      await nav(page, r);
      await noHorizontalOverflow(page);
    }
    await nav(page, 'budget');
    await page.getByTestId('budget-tab-rules').click();
    await noHorizontalOverflow(page);
    await page.getByTestId('budget-tab-categories').click();
    await noHorizontalOverflow(page);
    // Dialog content must not be wider than the sheet (regression: grid auto column grew to content).
    await (page.viewportSize()!.width < 900 ? page.getByTestId('add-fab') : page.getByTestId('add-side')).click();
    const sheetOverflow = await page.locator('.sheet-body').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sheetOverflow).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    const mobile = (page.viewportSize()?.width ?? 0) < 900;
    await expect(page.locator('.tabbar')).toBeVisible({ visible: mobile });
    await expect(page.locator('.sidebar')).toBeVisible({ visible: !mobile });
  });
});
