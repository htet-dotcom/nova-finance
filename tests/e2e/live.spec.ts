import { expect, nav, open, test } from './fixtures';

// Only runs with LIVE_RATES=1 (real network): verifies the real provider works under the CSP.
test('live exchange-rate provider: fetched, labelled Live with source and time', async ({ page, errors }) => {
  test.skip(!process.env.LIVE_RATES, 'set LIVE_RATES=1 to hit the real provider');
  await open(page);
  await nav(page, 'exchange');
  await expect(page.getByTestId('provider-rates')).toContainText('open.er-api.com', { timeout: 15_000 });
  await page.getByTestId('calc-from').selectOption('USD');
  await page.getByTestId('calc-to').selectOption('THB');
  await page.getByTestId('calc-amount').fill('100');
  await expect(page.getByTestId('calc-status')).toHaveText('Live');
  const rate = Number((await page.getByTestId('calc-rate').innerText()).replace(/,/g, ''));
  expect(rate).toBeGreaterThan(20);
  expect(rate).toBeLessThan(60);
  await expect(page.getByTestId('calc-result')).toContainText('Updated');
  expect(errors).toEqual([]);
});
