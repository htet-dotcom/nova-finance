import { formatMoney } from './currency';
import type { BudgetSnapshot } from './engine';
import type { CustomCurrency } from './types';

export interface SummaryLabels {
  income: string;
  spent: string;
  remaining: string;
  todayLimit: string;
  todaySpending: string;
  status: string;
  statusOk: (left: string) => string;
  statusOver: (by: string) => string;
  statusOther: string;
  daysLeft: (n: number) => string;
  footer: string;
}

/** Plain-text daily summary suitable for Telegram, Messenger, SMS, etc. */
export function buildDailySummary(
  s: BudgetSnapshot,
  labels: SummaryLabels,
  dateLabel: string,
  custom: readonly CustomCurrency[] = [],
): string {
  const m = (v: number) => formatMoney(v, s.currency, { custom });
  const status =
    s.status === 'over'
      ? labels.statusOver(m(s.overBy))
      : s.status === 'ok' || s.status === 'near'
        ? labels.statusOk(m(Math.max(0, s.todayRemaining)))
        : labels.statusOther;
  return [
    dateLabel,
    `${labels.income}: ${m(s.budgetIncome)}`,
    `${labels.spent}: ${m(s.totalExpenses)}`,
    `${labels.remaining}: ${m(s.balance)}`,
    `${labels.todayLimit}: ${m(s.dailyLimit)}`,
    `${labels.todaySpending}: ${m(s.spentToday)}`,
    `${labels.status}: ${status}`,
    labels.daysLeft(s.period.remainingDays),
    '',
    labels.footer,
  ].join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

interface ShareEnv {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeText?: (text: string) => Promise<void>;
}

function browserEnv(): ShareEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    share: nav?.share?.bind(nav),
    canShare: nav?.canShare?.bind(nav),
    writeText: nav?.clipboard?.writeText ? nav.clipboard.writeText.bind(nav.clipboard) : undefined,
  };
}

export function canNativeShare(env: ShareEnv = browserEnv()): boolean {
  return typeof env.share === 'function';
}

/** Copy text; falls back to a hidden textarea + execCommand on old browsers. */
export async function copyText(text: string, env: ShareEnv = browserEnv()): Promise<boolean> {
  try {
    if (env.writeText) {
      await env.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Native share sheet when available (Telegram, Messenger, …), otherwise copy to clipboard. */
export async function shareText(text: string, title: string, env: ShareEnv = browserEnv()): Promise<ShareOutcome> {
  const data: ShareData = { title, text };
  if (env.share && (!env.canShare || env.canShare(data))) {
    try {
      await env.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // Fall through to clipboard (e.g. NotAllowedError on desktop browsers).
    }
  }
  return (await copyText(text, env)) ? 'copied' : 'failed';
}

/**
 * Telegram's public share URL. Opens the Telegram app (or web.telegram.org) with
 * the text prefilled — no bot or API key involved.
 */
export function telegramShareUrl(text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(' ')}&text=${encodeURIComponent(text)}`;
}

// ---------------------------------------------------------------------------
// File sharing (reports)
// ---------------------------------------------------------------------------

/**
 * 'needs-gesture': the browser refused because the tap that started the share
 * expired while files were being generated (Safari); retrying from a new tap works.
 */
export type FileShareOutcome = 'shared' | 'cancelled' | 'unsupported' | 'needs-gesture' | 'failed';

/** True only when the browser says it can share these exact files. */
export function canShareFiles(files: File[], env: ShareEnv = browserEnv()): boolean {
  if (typeof env.share !== 'function' || typeof env.canShare !== 'function' || !files.length) return false;
  try {
    return env.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Share generated files through the native share sheet (Telegram, Messenger, …).
 * 'shared' is returned only when navigator.share() resolves — i.e. the browser
 * reports the share completed. Callers must fall back (download / text) on
 * 'unsupported' or 'failed'.
 */
export async function shareFiles(
  files: File[],
  meta: { title: string; text?: string },
  env: ShareEnv = browserEnv(),
): Promise<FileShareOutcome> {
  if (!canShareFiles(files, env)) return 'unsupported';
  try {
    await env.share!({ files, title: meta.title, ...(meta.text ? { text: meta.text } : {}) });
    return 'shared';
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'needs-gesture';
    return 'failed';
  }
}
