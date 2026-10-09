import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatMoney } from './lib/currency';
import { parts } from './lib/dates';
import { dateLocale } from './i18n';
import { useStore } from './store';

// ---------------------------------------------------------------------------
// Formatting hooks
// ---------------------------------------------------------------------------

export function useFmt() {
  const { data, t, today } = useStore();
  const { language, customCurrencies, primaryCurrency } = data.settings;
  const loc = `${dateLocale(language)}-u-nu-latn`;
  const money = (v: number, code = primaryCurrency, opts: { signed?: boolean } = {}) =>
    formatMoney(v, code, { custom: customCurrencies, ...opts });
  const date = (key: string, style: 'short' | 'long' | 'day' = 'short') => {
    const { y, m, d } = parts(key);
    const dt = new Date(y, m - 1, d);
    if (style === 'day') {
      if (key === today) return t.today;
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      if (dt.toDateString() === yest.toDateString() && key < today) return t.yesterday;
    }
    return new Intl.DateTimeFormat(loc, style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric' } : style === 'day' ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' }).format(dt);
  };
  const dateTime = (iso: string) => new Intl.DateTimeFormat(loc, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  const monthYear = (key: string) => {
    const { y, m } = parts(key);
    return new Intl.DateTimeFormat(loc, { month: 'long', year: 'numeric' }).format(new Date(y, m - 1, 1));
  };
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  return { money, date, dateTime, monthYear, pct };
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

const ToastCtx = createContext<(text: string, kind?: ToastItem['kind'], action?: ToastItem['action']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info', action?: ToastItem['action']) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.filter((x) => x.text !== text).slice(-2), { id, text, kind, action }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), action ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((x) => (
          <div key={x.id} className={`toast toast-${x.kind}`}>
            <span>{x.text}</span>
            {x.action && (
              <button
                className="toast-action"
                onClick={() => {
                  x.action!.run();
                  setItems((xs) => xs.filter((y) => y.id !== x.id));
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Modal / bottom sheet
// ---------------------------------------------------------------------------

const sheetStack: object[] = [];

export function Sheet({ title, onClose, children, footer, testId }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const token = {};
    sheetStack.push(token);
    // Only the top-most sheet reacts to Escape.
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && sheetStack[sheetStack.length - 1] === token && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      sheetStack.splice(sheetStack.indexOf(token), 1);
      if (!sheetStack.length) document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} data-testid={testId}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        <div className="sheet-body">{children}</div>
        {footer && <footer className="sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

export function useConfirm() {
  const [state, setState] = useState<{ text: string; danger?: boolean; resolve: (v: boolean) => void } | null>(null);
  const { t } = useStore();
  const ask = useCallback((text: string, danger = true) => new Promise<boolean>((resolve) => setState({ text, danger, resolve })), []);
  const node = state ? (
    <Sheet
      title={t.confirm}
      onClose={() => {
        state.resolve(false);
        setState(null);
      }}
      testId="confirm"
      footer={
        <>
          <button className="btn" onClick={() => (state.resolve(false), setState(null))}>
            {t.cancel}
          </button>
          <button className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => (state.resolve(true), setState(null))} data-testid="confirm-yes">
            {t.confirm}
          </button>
        </>
      }
    >
      <p>{state.text}</p>
    </Sheet>
  ) : null;
  return { ask, node };
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no icon font needed offline)
// ---------------------------------------------------------------------------

const PATHS: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  pie: 'M21 12A9 9 0 1 1 12 3v9zM14 3.2A9 9 0 0 1 20.8 10H14z',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  plus: 'M12 5v14M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  up: 'M18 15l-6-6-6 6',
  down: 'M6 9l6 6 6-6',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  check: 'M20 6 9 17l-5-5',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  wifiOff: 'M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.4-1.8M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01',
  calendar: 'M4 5h16v16H4zM16 3v4M8 3v4M4 11h16',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
};

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Charts (tiny, dependency-free SVG)
// ---------------------------------------------------------------------------

export function Progress({ ratio, tone }: { ratio: number; tone: 'ok' | 'near' | 'over' }) {
  const w = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className={`progress progress-${tone}`} role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${w}%` }} />
    </div>
  );
}

export function Ring({ ratio, tone, children }: { ratio: number; tone: string; children: ReactNode }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio));
  return (
    <div className={`ring ring-${tone}`}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} className="ring-track" />
        <circle cx="60" cy="60" r={r} className="ring-value" strokeDasharray={`${c * clamped} ${c}`} transform="rotate(-90 60 60)" />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function BarChart({
  values,
  labels,
  limit,
  format,
}: {
  values: number[];
  labels: string[];
  limit?: number;
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...values, limit ?? 0);
  const n = Math.max(values.length, 1);
  const W = n * 10;
  const H = 100;
  const showEvery = Math.ceil(n / 8);
  // Bars stretch to the container (preserveAspectRatio="none"); labels are HTML so text never distorts.
  return (
    <div className="bar-chart" role="img" aria-label="Daily spending chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="bar-svg">
        {values.map((v, i) => {
          const h = (v / max) * H;
          const over = limit !== undefined && limit > 0 && v > limit;
          return (
            <rect key={i} x={i * 10 + 1.5} y={H - h} width={7} height={Math.max(h, v > 0 ? 1 : 0)} className={over ? 'bar bar-over' : 'bar'}>
              <title>{`${labels[i]}: ${format(v)}`}</title>
            </rect>
          );
        })}
        {limit !== undefined && limit > 0 && limit <= max && (
          <line x1="0" x2={W} y1={H - (limit / max) * H} y2={H - (limit / max) * H} className="bar-limit" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <div className="bar-labels" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
        {labels.map((l, i) => (
          <span key={i}>{i % showEvery === 0 ? l : ''}</span>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
    </div>
  );
}
