import type { ExchangeRate, RateSource } from './types';

export const MANUAL_LABEL = 'Manual / User-entered rate';

/** How fresh a provider rate is considered "live" after it was fetched. */
export const LIVE_WINDOW_MS = 60 * 60 * 1000;

export type RateStatus = 'live' | 'cached' | 'manual';

export function rateId(base: string, quote: string, source: RateSource): string {
  return `${base}_${quote}_${source}`;
}

export function rateStatus(r: ExchangeRate, now: number = Date.now()): RateStatus {
  if (r.source === 'manual') return 'manual';
  const fetched = r.fetchedAt ? Date.parse(r.fetchedAt) : NaN;
  return Number.isFinite(fetched) && now - fetched <= LIVE_WINDOW_MS ? 'live' : 'cached';
}

export interface ConversionStep {
  from: string;
  to: string;
  /** Multiplier applied for this hop (already inverted when the stored rate is the reverse pair). */
  rate: number;
  rateRecord: ExchangeRate;
  inverted: boolean;
}

export interface ResolvedRate {
  from: string;
  to: string;
  rate: number;
  steps: ConversionStep[];
  /** 'manual' if any hop relies on a user-entered rate. */
  kind: 'identity' | 'manual' | 'provider';
  /** Oldest timestamp among the rates used. */
  updatedAt: string | null;
}

interface Edge {
  to: string;
  rate: number;
  rec: ExchangeRate;
  inverted: boolean;
}

function buildGraph(
  rates: readonly ExchangeRate[],
  source: RateSource | 'any',
  excludeProviderFor: ReadonlySet<string> = new Set(),
): Map<string, Edge[]> {
  const g = new Map<string, Edge[]>();
  const add = (from: string, e: Edge) => {
    const list = g.get(from) ?? [];
    list.push(e);
    g.set(from, list);
  };
  for (const r of rates) {
    if (!(r.rate > 0) || !Number.isFinite(r.rate)) continue;
    if (source !== 'any' && r.source !== source) continue;
    if (r.source === 'provider' && (excludeProviderFor.has(r.base) || excludeProviderFor.has(r.quote))) continue;
    add(r.base, { to: r.quote, rate: r.rate, rec: r, inverted: false });
    add(r.quote, { to: r.base, rate: 1 / r.rate, rec: r, inverted: true });
  }
  // Prefer manual edges, then direct (non-inverted) ones, when exploring.
  for (const list of g.values()) {
    list.sort((a, b) => score(a) - score(b));
  }
  return g;
}

const score = (e: Edge) => (e.rec.source === 'manual' ? 0 : 2) + (e.inverted ? 1 : 0);

function bfs(g: Map<string, Edge[]>, from: string, to: string, maxHops: number): Edge[] | null {
  const queue: { cur: string; path: Edge[] }[] = [{ cur: from, path: [] }];
  const seen = new Set([from]);
  while (queue.length) {
    const { cur, path } = queue.shift()!;
    if (path.length >= maxHops) continue;
    for (const e of g.get(cur) ?? []) {
      if (seen.has(e.to)) continue;
      const next = [...path, e];
      if (e.to === to) return next;
      seen.add(e.to);
      queue.push({ cur: e.to, path: next });
    }
  }
  return null;
}

/**
 * Find a conversion rate from → to.
 *
 * Resolution order (first hit wins):
 *  1. same currency → 1
 *  2. a path using only manual (user-entered) rates — the user's explicit choice always wins
 *  3. for "manual-first" currencies (default MMK) that have at least one manual rate, provider
 *     rates touching them are ignored, so e.g. USD→MMK goes USD→THB (provider) → MMK (manual)
 *     instead of using the provider's official MMK rate
 *  4. the shortest path over all rates, preferring manual and direct edges at each hop
 */
export function resolveRate(
  rates: readonly ExchangeRate[],
  from: string,
  to: string,
  opts: { manualFirst?: readonly string[]; maxHops?: number } = {},
): ResolvedRate | null {
  if (from === to) return { from, to, rate: 1, steps: [], kind: 'identity', updatedAt: null };
  const maxHops = opts.maxHops ?? 3;
  const manualFirst = new Set(
    (opts.manualFirst ?? []).filter((c) => rates.some((r) => r.source === 'manual' && (r.base === c || r.quote === c))),
  );
  const path =
    bfs(buildGraph(rates, 'manual'), from, to, maxHops) ??
    (manualFirst.size ? bfs(buildGraph(rates, 'any', manualFirst), from, to, maxHops) : null) ??
    bfs(buildGraph(rates, 'any'), from, to, maxHops);
  if (!path) return null;
  let rate = 1;
  let prev = from;
  const steps: ConversionStep[] = path.map((e) => {
    rate *= e.rate;
    const step = { from: prev, to: e.to, rate: e.rate, rateRecord: e.rec, inverted: e.inverted };
    prev = e.to;
    return step;
  });
  const updated = steps
    .map((s) => s.rateRecord.updatedAt)
    .filter(Boolean)
    .sort()[0];
  return {
    from,
    to,
    rate,
    steps,
    kind: steps.some((s) => s.rateRecord.source === 'manual') ? 'manual' : 'provider',
    updatedAt: updated ?? null,
  };
}

export function convert(
  rates: readonly ExchangeRate[],
  amount: number,
  from: string,
  to: string,
  manualFirst: readonly string[] = [],
): number | null {
  const r = resolveRate(rates, from, to, { manualFirst });
  return r ? amount * r.rate : null;
}

/**
 * Memoising converter for bulk work (the engine converts every transaction).
 * Returns null for amounts whose currency has no usable rate.
 */
export function makeConverter(rates: readonly ExchangeRate[], to: string, manualFirst: readonly string[] = []) {
  const cache = new Map<string, number | null>();
  return (amount: number, from: string): number | null => {
    if (from === to) return amount;
    if (!cache.has(from)) cache.set(from, resolveRate(rates, from, to, { manualFirst })?.rate ?? null);
    const r = cache.get(from)!;
    return r === null ? null : amount * r;
  };
}

// ---------------------------------------------------------------------------
// External rate provider
// ---------------------------------------------------------------------------

export interface ProviderResult {
  base: string;
  rates: Record<string, number>;
  /** Provider's own publication time (ISO). */
  publishedAt: string;
}

export interface RateProvider {
  id: string;
  label: string;
  fetchRates(base: string, signal?: AbortSignal): Promise<ProviderResult>;
}

/** Free, key-less, CORS-enabled provider. Rates update about once a day. */
export const openErApiProvider: RateProvider = {
  id: 'open-er-api',
  label: 'open.er-api.com (ExchangeRate-API)',
  async fetchRates(base, signal) {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`, {
      signal,
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Rate provider HTTP ${res.status}`);
    const json = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_unix?: number;
    };
    if (json.result !== 'success' || !json.rates) throw new Error('Rate provider returned no rates');
    return {
      base,
      rates: json.rates,
      publishedAt: new Date((json.time_last_update_unix ?? Date.now() / 1000) * 1000).toISOString(),
    };
  },
};

/** Convert a provider response into storable rate records for the requested currencies. */
export function providerResultToRates(
  result: ProviderResult,
  currencies: readonly string[],
  label: string,
  fetchedAt: string,
): ExchangeRate[] {
  const out: ExchangeRate[] = [];
  for (const code of currencies) {
    if (code === result.base) continue;
    const rate = result.rates[code];
    if (typeof rate !== 'number' || !(rate > 0) || !Number.isFinite(rate)) continue;
    out.push({
      id: rateId(result.base, code, 'provider'),
      base: result.base,
      quote: code,
      rate,
      source: 'provider',
      sourceLabel: label,
      updatedAt: result.publishedAt,
      fetchedAt,
    });
  }
  return out;
}

export function makeManualRate(base: string, quote: string, rate: number, now = new Date().toISOString(), label = MANUAL_LABEL): ExchangeRate {
  return {
    id: rateId(base, quote, 'manual'),
    base,
    quote,
    rate,
    source: 'manual',
    sourceLabel: label.trim() || MANUAL_LABEL,
    updatedAt: now,
    fetchedAt: null,
  };
}
