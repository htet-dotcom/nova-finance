import { test as base, expect, type Page } from '@playwright/test';

export const MOCK_RATES = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: Math.floor(Date.now() / 1000) - 3600,
  rates: { USD: 1, THB: 35, MMK: 2100, EUR: 0.9, GBP: 0.78, SGD: 1.3, MYR: 4.4, JPY: 150, CNY: 7.2 },
};

/** Console errors / uncaught exceptions collected during a test. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    // Deterministic exchange rates unless we are smoke-testing production with live data.
    if (!process.env.LIVE_RATES) {
      await page.route('https://open.er-api.com/**', (route) => route.fulfill({ json: MOCK_RATES }));
    }
    await use(errors);
  },
});

export { expect };

export async function open(page: Page, hash = '') {
  await page.goto(`./${hash ? `#/${hash}` : ''}`);
  await expect(page.locator('.shell')).toBeVisible();
}

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;

export async function nav(page: Page, route: string) {
  if (isMobile(page)) await page.getByTestId(`nav-${route}`).click();
  else await page.locator(`.sidebar a[href="#/${route}"]`).click();
  await expect(page.getByTestId(route)).toBeVisible();
}

export async function addTx(
  page: Page,
  opts: { type?: 'income' | 'expense'; amount: string; category?: string; currency?: string; note?: string; date?: string },
) {
  await (isMobile(page) ? page.getByTestId('add-fab') : page.getByTestId('add-side')).click();
  const form = page.getByTestId('tx-form');
  await expect(form).toBeVisible();
  if (opts.type === 'income') await form.getByTestId('type-income').click();
  if (opts.currency) await form.getByTestId('tx-currency').selectOption(opts.currency);
  await form.getByTestId('tx-amount').fill(opts.amount);
  if (opts.category) await form.getByTestId(`cat-${opts.category}`).click();
  if (opts.date) await form.getByTestId('tx-date').fill(opts.date);
  if (opts.note) await form.getByTestId('tx-note').fill(opts.note);
  await form.getByTestId('tx-save').click();
  await expect(form).toBeHidden();
}

/** Switch the budget period to 30 days starting today so expectations are date-independent. */
export async function use30DayPeriod(page: Page) {
  await nav(page, 'budget');
  await page.getByTestId('budget-tab-rules').click();
  await page.getByTestId('period-rolling').click();
  await expect(page.getByTestId('period-length')).toHaveValue('30');
  await nav(page, 'dashboard');
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'page should not scroll horizontally').toBeLessThanOrEqual(1);
}
