import { addTx, expect, nav, noHorizontalOverflow, open, test } from './fixtures';
import type { Page } from '@playwright/test';

async function addAccount(page: Page, name: string, currency: string, opening: string) {
  await page.getByTestId('account-add').click();
  const form = page.getByTestId('account-form');
  await form.getByTestId('account-name').fill(name);
  await form.getByTestId('account-currency').selectOption(currency);
  await form.getByTestId('account-opening').fill(opening);
  await form.getByTestId('account-save').click();
  await expect(form).toBeHidden();
}

const balanceOf = (page: Page, name: string) => page.getByTestId('account-item').filter({ hasText: name }).getByTestId('account-balance');

test.describe('wallet: accounts, transfers, net worth', () => {
  test('balances follow transactions and cross-currency transfers; net worth in primary currency', async ({ page, errors }) => {
    await open(page);
    await nav(page, 'wallet');
    await expect(page.getByTestId('net-worth-value')).toHaveText('฿0');
    await addAccount(page, 'Cash', 'THB', '1000');
    await addAccount(page, 'KBZ Bank', 'MMK', '0');
    await expect(balanceOf(page, 'Cash')).toHaveText('฿1,000');

    // Spending from an account lowers its balance.
    await addTx(page, { amount: '200', category: 'cat_food' });
    await expect(balanceOf(page, 'Cash')).toHaveText('฿800');

    // Transfer 100 THB → MMK. Mock rates: 1 USD = 35 THB = 2100 MMK → 1 THB = 60 MMK.
    await page.getByTestId('transfer-add').click();
    const tf = page.getByTestId('transfer-form');
    await tf.getByTestId('transfer-from').selectOption({ label: '💵 Cash (THB)' });
    await tf.getByTestId('transfer-to').selectOption({ label: '💵 KBZ Bank (MMK)' });
    await tf.getByTestId('transfer-amount').fill('100');
    await expect(tf.getByTestId('transfer-to-amount')).toHaveValue('6000');
    await tf.getByTestId('transfer-to-amount').fill('5900'); // the money changer's real rate
    await tf.getByTestId('transfer-save').click();
    await expect(tf).toBeHidden();

    await expect(balanceOf(page, 'Cash')).toHaveText('฿700');
    await expect(balanceOf(page, 'KBZ Bank')).toHaveText('5,900 Ks');
    await expect(page.getByTestId('transfer-row')).toHaveCount(1);
    // 700 THB + 5,900 MMK (= 98.33 THB)
    await expect(page.getByTestId('net-worth-value')).toHaveText('฿798.33');

    // Transfers are not spending: today's spending is unchanged.
    await nav(page, 'dashboard');
    await expect(page.getByTestId('spent-today')).toHaveText('฿200');
    await expect(page.getByTestId('glance-net-worth')).toHaveText('฿798.33');

    // Account filter on the transactions list.
    await nav(page, 'transactions');
    await page.getByTestId('filter-account').selectOption({ label: '💵 KBZ Bank' });
    await expect(page.getByTestId('tx-count')).toContainText('0');
    await page.getByTestId('filter-account').selectOption({ label: '💵 Cash' });
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
    await expect(page.getByTestId('tx-row')).toContainText('Cash');
    expect(errors).toEqual([]);
  });

  test('deleting a used account keeps its transactions (unassigned)', async ({ page }) => {
    await open(page);
    await nav(page, 'wallet');
    await addAccount(page, 'Wave', 'THB', '0');
    await addTx(page, { amount: '50', category: 'cat_food' });
    await page.getByTestId('account-item').filter({ hasText: 'Wave' }).locator('.cat-main').click();
    await page.getByTestId('account-delete').click();
    await expect(page.getByTestId('confirm')).toContainText('archive');
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('account-item')).toHaveCount(0);
    await nav(page, 'transactions');
    await expect(page.getByTestId('tx-row')).toHaveCount(1);
  });
});

test.describe('savings goals', () => {
  test('create, deposit, withdraw (guarded), progress and dashboard glance', async ({ page, errors }) => {
    await open(page);
    await nav(page, 'wallet');
    await page.getByTestId('wallet-tab-goals').click();
    await page.getByTestId('goal-add-open').click();
    const form = page.getByTestId('goal-form');
    await form.getByTestId('goal-name').fill('New phone');
    await form.getByTestId('goal-target').fill('1000');
    await form.getByTestId('goal-save').click();
    await expect(form).toBeHidden();

    await page.getByTestId('goal-item').click();
    const d = page.getByTestId('goal-detail');
    await d.getByTestId('goal-amount').fill('250');
    await d.getByTestId('goal-add').click();
    await expect(d.getByTestId('goal-saved')).toHaveText('฿250');

    await d.getByTestId('goal-mode-withdraw').click();
    await d.getByTestId('goal-amount').fill('300');
    await d.getByTestId('goal-add').click();
    await expect(d.getByRole('alert')).toContainText('cannot take out more');
    await expect(d.getByTestId('goal-saved')).toHaveText('฿250');

    await d.getByTestId('goal-amount').fill('50');
    await d.getByTestId('goal-add').click();
    await expect(d.getByTestId('goal-saved')).toHaveText('฿200');
    await expect(d.getByTestId('goal-history').locator('li')).toHaveCount(2);
    await page.keyboard.press('Escape');

    await expect(page.getByTestId('goal-item')).toContainText('20%');
    await expect(page.getByTestId('goal-item')).toContainText('฿800 to go');
    await nav(page, 'dashboard');
    await expect(page.getByTestId('wallet-glance')).toContainText('New phone');
    expect(errors).toEqual([]);
  });
});

test.describe('app lock', () => {
  test('PIN lock: set up, locked after reload, wrong PIN rejected, correct PIN unlocks, turn off', async ({ page, errors }) => {
    await open(page);
    await nav(page, 'settings');
    await page.getByTestId('lock-setup').click();
    const flow = page.getByTestId('pin-flow');
    await flow.getByTestId('pin-new').fill('2580');
    await flow.getByTestId('pin-confirm').fill('2589');
    await flow.getByTestId('pin-flow-save').click();
    await expect(flow.getByRole('alert')).toContainText('do not match');
    await flow.getByTestId('pin-confirm').fill('2580');
    await flow.getByTestId('pin-flow-save').click();
    await expect(flow).toBeHidden();
    await expect(page.getByTestId('security')).toContainText('On');

    await page.reload();
    const lock = page.getByTestId('lock-screen');
    await expect(lock).toBeVisible();
    await expect(page.locator('.shell')).toHaveCount(0);
    for (const d of '1111') await lock.getByTestId(`pin-${d}`).click();
    await expect(lock.getByRole('alert')).toContainText('Wrong PIN');
    await expect(page.locator('.shell')).toHaveCount(0);
    // Physical keyboard works too.
    await page.keyboard.type('2580');
    await expect(lock).toBeHidden();
    // Unlocking returns to the page that was open (the reload kept #/settings).
    await expect(page.getByTestId('settings')).toBeVisible();

    await page.getByTestId('lock-now').click();
    await expect(page.getByTestId('lock-screen')).toBeVisible();
    await page.keyboard.type('2580');
    await expect(page.getByTestId('settings')).toBeVisible();

    await page.getByTestId('lock-disable').click();
    await page.getByTestId('pin-current').fill('0000');
    await page.getByTestId('pin-flow-save').click();
    await expect(page.getByTestId('pin-flow').getByRole('alert')).toContainText('not correct');
    await page.getByTestId('pin-current').fill('2580');
    await page.getByTestId('pin-flow-save').click();
    await expect(page.getByTestId('lock-setup')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('settings')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('forgot PIN: erases data and removes the lock', async ({ page }) => {
    await open(page);
    await addTx(page, { amount: '10', category: 'cat_food' });
    await nav(page, 'settings');
    await page.getByTestId('lock-setup').click();
    await page.getByTestId('pin-new').fill('1234');
    await page.getByTestId('pin-confirm').fill('1234');
    await page.getByTestId('pin-flow-save').click();
    await expect(page.getByTestId('pin-flow')).toBeHidden();
    await page.reload();
    await page.getByTestId('lock-forgot').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    await expect(page.getByTestId('lock-setup')).toBeVisible();
    await nav(page, 'dashboard');
    await expect(page.getByTestId('spent-today')).toHaveText('฿0');
    await page.reload();
    await expect(page.getByTestId('dashboard')).toBeVisible();
  });
});

test.describe('insights', () => {
  test('highlights, charts with table view, weekday chart; no overflow', async ({ page, errors }) => {
    await open(page);
    await addTx(page, { type: 'income', amount: '5000', category: 'cat_salary' });
    await addTx(page, { amount: '120', category: 'cat_food' });
    await addTx(page, { amount: '80', category: 'cat_transport' });
    await nav(page, 'insights');
    await expect(page.getByTestId('insight-list')).toBeVisible();
    await expect(page.getByTestId('trend-card').locator('.gbar-group')).toHaveCount(6);
    await expect(page.getByTestId('trend-card').locator('.legend')).toContainText('Income');
    await page.getByTestId('trend-card').locator('.table-view summary').click();
    await expect(page.getByTestId('trend-card').locator('tbody tr')).toHaveCount(6);
    await expect(page.getByTestId('ins-total')).toHaveText('฿200');
    await expect(page.getByTestId('category-card').locator('.breakdown li')).toHaveCount(2);
    // Hover tooltip on a bar group.
    await page.getByTestId('trend-card').locator('.gbar-group').last().hover();
    await expect(page.getByRole('tooltip')).toContainText('฿5,000');
    await expect(page.getByTestId('weekday-card').locator('.gbar-group')).toHaveCount(7);
    await noHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });

  test('Myanmar language shows translated wallet, goals and insights', async ({ page }) => {
    await open(page);
    await nav(page, 'settings');
    await page.getByTestId('lang-my').click();
    await nav(page, 'wallet');
    await expect(page.getByTestId('wallet')).toContainText('ပိုက်ဆံအိတ်');
    await expect(page.getByTestId('wallet-tab-goals')).toHaveText('ငွေစုပန်းတိုင်');
    await nav(page, 'insights');
    await expect(page.getByTestId('insights')).toContainText('သုံးသပ်ချက်');
  });
});
