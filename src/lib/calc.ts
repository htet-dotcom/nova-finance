// Safe arithmetic for amounts: + − × ÷, parentheses, unary minus and calculator-style %.
// A small recursive-descent parser — never uses eval/Function.
//
// Percent follows phone calculators:
//   200 + 10%  → 220   (10 % of the left side)
//   200 − 10%  → 180
//   200 × 10%  → 20    (10 % = 0.1)
//   50%        → 0.5

export type CalcResult = { ok: true; value: number } | { ok: false; error: 'empty' | 'syntax' | 'divide-by-zero' | 'too-large' };

const MAX = 1e15;
const MAX_LEN = 200;

type Tok = { t: 'num'; v: number } | { t: 'op'; v: '+' | '-' | '*' | '/' } | { t: '%' } | { t: '(' } | { t: ')' };

/** Normalise the symbols people type or paste: × ÷ − – x, thousands separators, spaces. */
export function normalizeExpr(input: string): string {
  return input
    .replace(/[×xX]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/,(?=\d{3}(\D|$))/g, '') // 1,250.50 → 1250.50 (only real thousands separators)
    .replace(/[\s_]/g, '');
}

function tokenize(s: string): Tok[] | null {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[\d.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
      if (!m) return null;
      out.push({ t: 'num', v: Number(m[1]) });
      i += m[1].length;
      continue;
    }
    if (c === '+' || c === '-' || c === '*' || c === '/') out.push({ t: 'op', v: c });
    else if (c === '%') out.push({ t: '%' });
    else if (c === '(') out.push({ t: '(' });
    else if (c === ')') out.push({ t: ')' });
    else return null;
    i++;
  }
  return out;
}

class Div0 extends Error {}

/** Evaluate an expression. Returns a value rounded to 10 decimals to hide float noise (0.1+0.2 → 0.3). */
export function evaluate(input: string): CalcResult {
  const s = normalizeExpr(input);
  if (!s) return { ok: false, error: 'empty' };
  if (s.length > MAX_LEN) return { ok: false, error: 'syntax' };
  const toks = tokenize(s);
  if (!toks) return { ok: false, error: 'syntax' };
  let p = 0;
  const peek = () => toks[p];

  // factor := ('-'|'+') factor | number | '(' expr ')' ; followed by optional '%'
  // Returns the value and whether it carried a percent sign.
  const factor = (depth: number): { v: number; pct: boolean } => {
    if (depth > 50) throw new SyntaxError();
    const tk = peek();
    if (!tk) throw new SyntaxError();
    let v: number;
    if (tk.t === 'op' && (tk.v === '-' || tk.v === '+')) {
      p++;
      const f = factor(depth + 1);
      return { v: tk.v === '-' ? -f.v : f.v, pct: f.pct };
    }
    if (tk.t === 'num') {
      p++;
      v = tk.v;
    } else if (tk.t === '(') {
      p++;
      v = expr(depth + 1);
      if (peek()?.t !== ')') throw new SyntaxError();
      p++;
    } else throw new SyntaxError();
    let pct = false;
    while (peek()?.t === '%') {
      p++;
      v = pct ? v / 100 : v;
      pct = true;
    }
    return { v, pct };
  };

  const term = (depth: number): number => {
    const first = factor(depth);
    let v = first.pct ? first.v / 100 : first.v;
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '*' && tk.v !== '/')) return v;
      p++;
      const f = factor(depth);
      const r = f.pct ? f.v / 100 : f.v;
      if (tk.v === '*') v *= r;
      else {
        if (r === 0) throw new Div0();
        v /= r;
      }
    }
  };

  const expr = (depth: number): number => {
    let v = term(depth);
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== 'op' || (tk.v !== '+' && tk.v !== '-')) return v;
      p++;
      // "a + b%" means a + (a × b / 100) when the right side is a bare percentage.
      const start = p;
      const f = factor(depth);
      const next = peek();
      const barePct = f.pct && !(next && next.t === 'op' && (next.v === '*' || next.v === '/'));
      let r: number;
      if (barePct) r = (v * f.v) / 100;
      else {
        p = start;
        r = term(depth);
      }
      v = tk.v === '+' ? v + r : v - r;
    }
  };

  try {
    const v = expr(0);
    if (p !== toks.length) return { ok: false, error: 'syntax' };
    if (!Number.isFinite(v)) return { ok: false, error: 'too-large' };
    if (Math.abs(v) > MAX) return { ok: false, error: 'too-large' };
    return { ok: true, value: Number(v.toFixed(10)) || 0 };
  } catch (e) {
    return { ok: false, error: e instanceof Div0 ? 'divide-by-zero' : 'syntax' };
  }
}

/** True when the text contains an operator, i.e. it is a calculation rather than a plain number. */
export function isExpression(input: string): boolean {
  return /[-+*/×÷x−%()]/.test(normalizeExpr(input).replace(/^[-+]/, ''));
}

/**
 * Parse an amount field that may contain arithmetic ("120+35"). Returns null if invalid.
 * Plain numbers keep the existing strict parser's behaviour.
 */
export function parseAmountExpr(input: string, parsePlain: (s: string) => number | null): number | null {
  if (!isExpression(input)) return parsePlain(input);
  const r = evaluate(input);
  return r.ok ? r.value : null;
}
