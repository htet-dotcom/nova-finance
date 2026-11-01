import { expect, nav, open, test } from './fixtures';
import type { Page } from '@playwright/test';

const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1000) < 900;
const openTxForm = async (page: Page) => {
  await (isMobile(page) ? page.getByTestId('add-fab') : page.getByTestId('add-side')).click();
  const form = page.getByTestId('tx-form');
  await expect(form).toBeVisible();
  return form;
};

test.describe('calculator', () => {
  test('type a calculation straight into the amount field', async ({ page, errors }) => {
    await open(page);
    const form = await openTxForm(page);
    await form.getByTestId('tx-amount').fill('120+35');
    await expect(form.getByTestId('expr-preview')).toHaveText('= ฿155');
    await form.getByTestId('tx-amount').fill('120+');
    await expect(form.getByTestId('expr-preview')).toContainText('Finish the calculation');
    await form.getByTestId('tx-amount').fill('120+35+18');
    await form.getByTestId('tx-save').click();
    await expect(form).toBeHidden();
    await expect(page.getByTestId('spent-today')).toHaveText('฿173');
    expect(errors).toEqual([]);
  });

  test('calculator button: keypad with percent, result goes into the amount', async ({ page, errors }) => {
    await open(page);
    const form = await openTxForm(page);
    await form.getByTestId('pcalc-open').click();
    const calc = page.getByTestId('pocket-calc');
    for (const k of ['2', '0', '0', 'add', '1', '0', 'pct']) await calc.getByTestId(`pcalc-${k}`).click();
    await expect(calc.getByTestId('pcalc-expr')).toHaveText('200+10%');
    await expect(calc.getByTestId('pcalc-result')).toHaveText('= 220');
    await calc.getByTestId('pcalc-use').click();
    await expect(calc).toBeHidden();
    await expect(form.getByTestId('tx-amount')).toHaveValue('220');
    await form.getByTestId('tx-save').click();
    await expect(page.getByTestId('spent-today')).toHaveText('฿220');
    expect(errors).toEqual([]);
  });

  test('opening with a plain amount: operators continue it, digits start over', async ({ page }) => {
    await open(page);
    const form = await openTxForm(page);
    await form.getByTestId('tx-amount').fill('155');
    await form.getByTestId('pcalc-open').click();
    const calc = page.getByTestId('pocket-calc');
    for (const k of ['add', '2', '0']) await calc.getByTestId(`pcalc-${k}`).click();
    await expect(calc.getByTestId('pcalc-result')).toHaveText('= 175');
    await calc.getByTestId('pcalc-C').click();
    await page.keyboard.press('Escape');
    await form.getByTestId('pcalc-open').click();
    await calc.getByTestId('pcalc-9').click();
    await expect(calc.getByTestId('pcalc-expr')).toHaveText('9');
  });

  test('standalone calculator from Exchange works with the keyboard', async ({ page, errors }) => {
    await open(page);
    await nav(page, 'exchange');
    await page.getByTestId('open-pocket-calc').click();
    const calc = page.getByTestId('pocket-calc');
    await page.keyboard.type('12*3');
    await expect(calc.getByTestId('pcalc-expr')).toHaveText('12×3');
    await page.keyboard.press('Enter');
    await expect(calc.getByTestId('pcalc-expr')).toHaveText('36');
    await page.keyboard.type('/0');
    await expect(calc.getByTestId('pcalc-result')).toHaveText('Cannot divide by 0');
    await calc.getByTestId('pcalc-C').click();
    await expect(calc.getByTestId('pcalc-expr')).toHaveText('0');
    // The currency converter on the same page is unaffected.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('calculator')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('goal deposit and transfer amounts accept calculations', async ({ page }) => {
    await open(page);
    await nav(page, 'wallet');
    await page.getByTestId('wallet-tab-goals').click();
    await page.getByTestId('goal-add-open').click();
    await page.getByTestId('goal-name').fill('Trip');
    await page.getByTestId('goal-target').fill('1000');
    await page.getByTestId('goal-save').click();
    await page.getByTestId('goal-item').click();
    const d = page.getByTestId('goal-detail');
    await d.getByTestId('goal-amount').fill('3*50');
    await expect(d.getByTestId('expr-preview')).toHaveText('= ฿150');
    await d.getByTestId('goal-add').click();
    await expect(d.getByTestId('goal-saved')).toHaveText('฿150');
  });
});
