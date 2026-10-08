import { describe, expect, it, vi } from 'vitest';
import { computeBudget } from '../../src/lib/engine';
import { buildDailySummary, canNativeShare, copyText, shareText, telegramShareUrl, type SummaryLabels } from '../../src/lib/share';
import { input, tx } from './helpers';

const labels: SummaryLabels = {
  income: 'Income',
  spent: 'Spent',
  remaining: 'Remaining',
  todayLimit: "Today's limit",
  todaySpending: "Today's spending",
  status: 'Status',
  statusOk: (left) => `On track (${left} left today)`,
  statusOver: (by) => `Over budget by ${by}`,
  statusOther: 'No budget available',
  daysLeft: (n) => `${n} days left`,
  footer: '— Nova Finance',
};

describe('daily summary text', () => {
  it('matches the requested share format', () => {
    const s = computeBudget(input([tx('income', 1750, '2026-09-01'), tx('expense', 72, '2026-09-01')], '2026-09-01'));
    const text = buildDailySummary(s, labels, 'September 1');
    expect(text).toContain('September 1');
    expect(text).toContain('Income: ฿1,750');
    expect(text).toContain('Spent: ฿72');
    expect(text).toContain("Today's limit: ฿58.33");
    expect(text).toContain("Today's spending: ฿72");
    expect(text).toContain('Status: Over budget by ฿13.67');
  });

  it('on-track status', () => {
    const s = computeBudget(input([tx('income', 3000, '2026-09-01'), tx('expense', 40, '2026-09-01')], '2026-09-01'));
    expect(buildDailySummary(s, labels, 'x')).toContain('Status: On track (฿60 left today)');
  });
});

describe('sharing', () => {
  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('hello', 't', { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 't', text: 'hello' });
    expect(canNativeShare({ share })).toBe(true);
  });

  it('reports cancel when the user dismisses the sheet', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }));
    expect(await shareText('hello', 't', { share })).toBe('cancelled');
  });

  it('falls back to clipboard when Web Share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('hello', 't', { writeText })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(canNativeShare({ writeText })).toBe(false);
  });

  it('falls back to clipboard when share fails for other reasons', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('hello', 't', { share, writeText })).toBe('copied');
  });

  it('respects canShare()', async () => {
    const share = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await shareText('hello', 't', { share, canShare: () => false, writeText })).toBe('copied');
    expect(share).not.toHaveBeenCalled();
  });

  it('copy reports failure when nothing is available', async () => {
    expect(await copyText('x', {})).toBe(false);
  });

  it('builds a Telegram share link without any bot', () => {
    const url = telegramShareUrl('Spent: ฿72\nStatus: ok & fine');
    expect(url.startsWith('https://t.me/share/url?')).toBe(true);
    const text = new URL(url).searchParams.get('text');
    expect(text).toBe('Spent: ฿72\nStatus: ok & fine');
  });
});
