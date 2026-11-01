import { useCallback, useEffect, useRef, useState } from 'react';
import { evaluate, isExpression, type CalcResult } from '../lib/calc';
import { parseAmount } from '../lib/currency';
import { copyText } from '../lib/share';
import { useStore } from '../store';
import { Icon, Sheet, useFmt, useToast } from '../ui';

const OPS = ['+', '−', '×', '÷'];
const isOp = (c: string | undefined) => !!c && OPS.includes(c);
/** Show results without float noise or exponent notation, grouped for readability. */
const show = (v: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(v);

/**
 * Pocket calculator. With `onUse`, the result can be put into the amount field that opened it.
 */
export function Calculator({ initial = '', currency, onUse, onClose }: { initial?: string; currency?: string; onUse?: (value: number) => void; onClose: () => void }) {
  const { t } = useStore();
  const { money } = useFmt();
  const toast = useToast();
  const [expr, setExpr] = useState(() => (initial && (isExpression(initial) || parseAmount(initial) !== null) ? initial.replace(/\*/g, '×').replace(/\//g, '÷') : ''));
  // A plain number from the amount field behaves like a fresh result: digits start over,
  // operators continue from it (e.g. 155 → "+20" → 175).
  const [justEvaluated, setJustEvaluated] = useState(() => !!initial && !isExpression(initial) && parseAmount(initial) !== null);
  const exprRef = useRef(expr);
  exprRef.current = expr;
  const justEvaluatedRef = useRef(justEvaluated);
  justEvaluatedRef.current = justEvaluated;

  const result: CalcResult = evaluate(expr);
  const errorText = (r: CalcResult) =>
    r.ok ? '' : r.error === 'divide-by-zero' ? t.calcDivZero : r.error === 'too-large' ? t.calcTooLarge : r.error === 'syntax' ? t.calcIncomplete : '';

  const press = useCallback((k: string) => {
    const cur = exprRef.current;
    let next = cur;
    if (k === 'C') next = '';
    else if (k === '⌫') next = cur.slice(0, -1);
    else if (k === '=') {
      const r = evaluate(cur);
      if (r.ok) {
        next = String(r.value);
        setJustEvaluated(true);
        setExpr(next);
        return;
      }
      return;
    } else if (isOp(k)) {
      if (!cur) next = k === '−' ? '−' : '';
      else if (isOp(cur.slice(-1))) next = cur.slice(0, -1) + k;
      else next = cur + k;
    } else if (k === '.') {
      const lastNum = cur.split(/[+−×÷()%]/).pop() ?? '';
      if (justEvaluatedRef.current) next = '0.';
      else if (!lastNum.includes('.')) next = cur + (lastNum === '' ? '0.' : '.');
    } else if (k === '%') {
      if (cur && /[\d)]$/.test(cur)) next = cur + '%';
    } else if (k === '(' || k === ')') next = cur + k;
    else {
      // digits: typing after "=" starts a new calculation
      next = justEvaluatedRef.current ? k : cur === '0' ? k : cur + k;
    }
    setJustEvaluated(false);
    if (next.length <= 120) setExpr(next);
  }, []);

  useEffect(() => {
    const map: Record<string, string> = { '*': '×', x: '×', X: '×', '/': '÷', '-': '−', '+': '+', Enter: '=', '=': '=', Backspace: '⌫', Delete: 'C', ',': '.', '.': '.', '%': '%', '(': '(', ')': ')' };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = /^\d$/.test(e.key) ? e.key : map[e.key];
      if (!k) return;
      e.preventDefault();
      press(k);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  const usable = result.ok && result.value > 0;
  const keys = ['C', '⌫', '%', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '00', '0', '.', '='];

  return (
    <Sheet
      title={t.pocketCalc}
      onClose={onClose}
      testId="pocket-calc"
      footer={
        onUse ? (
          <>
            <button className="btn" onClick={onClose}>{t.cancel}</button>
            <button className="btn btn-primary" disabled={!usable} onClick={() => result.ok && (onUse(result.value), onClose())} data-testid="pcalc-use">
              {t.calcUse}{usable && currency ? ` ${money(result.value, currency)}` : ''}
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={!result.ok} onClick={async () => result.ok && (await copyText(String(result.value))) && toast(t.copied, 'success')} data-testid="pcalc-copy">
              <Icon name="copy" size={16} /> {t.copy}
            </button>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={onClose}>{t.done}</button>
          </>
        )
      }
    >
      <div className="pcalc-display" aria-live="polite">
        <div className="pcalc-expr" data-testid="pcalc-expr">{expr || '0'}</div>
        <div className={`pcalc-out ${!result.ok && expr ? 'pcalc-out-muted' : ''}`} data-testid="pcalc-result">
          {result.ok ? (justEvaluated ? '' : `= ${show(result.value)}`) : errorText(result)}
        </div>
      </div>
      <div className="pcalc-keys" role="group" aria-label={t.pocketCalc}>
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            className={`pcalc-key ${isOp(k) || k === '%' ? 'pcalc-op' : ''} ${k === '=' ? 'pcalc-eq' : ''} ${k === 'C' || k === '⌫' ? 'pcalc-fn' : ''}`}
            onClick={() => (k === '00' ? (press('0'), press('0')) : press(k))}
            aria-label={{ C: t.calcClear, '⌫': t.lockBackspace, '÷': t.calcDivide, '×': t.calcMultiply, '−': t.calcMinus, '+': t.calcPlus, '=': t.calcEquals }[k] ?? k}
            data-testid={`pcalc-${{ '÷': 'div', '×': 'mul', '−': 'sub', '+': 'add', '=': 'eq', '⌫': 'back', '%': 'pct', '.': 'dot' }[k] ?? k}`}
          >
            {k}
          </button>
        ))}
      </div>
      <p className="muted small">{t.calcHint}</p>
    </Sheet>
  );
}

/** Small 🧮 button for amount fields. */
export function CalcButton({ value, currency, onResult, testId = 'pcalc-open' }: { value: string; currency?: string; onResult: (v: string) => void; testId?: string }) {
  const { t } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="pcalc-btn" onClick={() => setOpen(true)} aria-label={t.pocketCalc} title={t.pocketCalc} data-testid={testId}>
        <Icon name="calc" size={20} />
      </button>
      {open && <Calculator initial={value} currency={currency} onUse={(v) => onResult(String(v))} onClose={() => setOpen(false)} />}
    </>
  );
}

/** "= 173" preview under an amount field when the user typed a calculation. */
export function ExprPreview({ text, currency }: { text: string; currency: string }) {
  const { t } = useStore();
  const { money } = useFmt();
  if (!isExpression(text)) return null;
  const r = evaluate(text);
  return (
    <p className={`small expr-preview ${r.ok ? '' : 'warn-text'}`} data-testid="expr-preview">
      {r.ok ? `= ${money(r.value, currency)}` : t.calcIncomplete}
    </p>
  );
}
