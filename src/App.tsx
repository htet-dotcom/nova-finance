import { useCallback, useEffect, useState } from 'react';
import { TxForm } from './components/TxForm';
import type { Transaction, TxType } from './lib/types';
import { useLock } from './lock';
import { useServiceWorker } from './pwa';
import { useStore } from './store';
import { Icon, useToast } from './ui';
import { Budget } from './views/Budget';
import { Dashboard } from './views/Dashboard';
import { Exchange } from './views/Exchange';
import { Insights } from './views/Insights';
import { Reports } from './views/Reports';
import { Settings } from './views/Settings';
import { Transactions } from './views/Transactions';
import { Wallet } from './views/Wallet';

const ROUTES = ['dashboard', 'transactions', 'budget', 'wallet', 'insights', 'exchange', 'settings', 'reports'] as const;
type Route = (typeof ROUTES)[number];

function parseHash(): { route: Route; sub?: string } {
  const [r, sub] = window.location.hash.replace(/^#\/?/, '').split('/');
  return { route: (ROUTES as readonly string[]).includes(r) ? (r as Route) : 'dashboard', sub };
}

export function App() {
  const { ready, loadError, t, online } = useStore();
  const sw = useServiceWorker();
  const toast = useToast();
  const lock = useLock();
  const [{ route, sub }, setLoc] = useState(parseHash);
  const [form, setForm] = useState<{ tx?: Transaction; type?: TxType } | null>(null);

  useEffect(() => {
    const on = () => {
      setLoc(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // Home-screen shortcut: ?add=expense
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const add = params.get('add');
    if (ready && (add === 'expense' || add === 'income')) {
      setForm({ type: add });
      history.replaceState(null, '', window.location.pathname + window.location.hash);
    }
  }, [ready]);

  useEffect(() => {
    if (sw.offlineReady) {
      toast(t.offlineReady, 'success');
      sw.dismissOfflineReady();
    }
  }, [sw.offlineReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = useCallback((r: string) => {
    window.location.hash = `/${r}`;
  }, []);
  const edit = useCallback((tx: Transaction) => setForm({ tx }), []);

  if (loadError) {
    return (
      <div className="boot-error">
        <h1>⚠️</h1>
        <p>Storage is unavailable: {loadError}</p>
        <p className="muted">Private browsing modes can block local storage. Open the app in a normal window.</p>
      </div>
    );
  }
  if (!ready) return <div className="boot" aria-busy="true" />;

  const nav: { r: Route; icon: string; label: string }[] = [
    { r: 'dashboard', icon: 'home', label: t.navDashboard },
    { r: 'transactions', icon: 'list', label: t.navTransactions },
    { r: 'wallet', icon: 'wallet', label: t.navWallet },
    { r: 'budget', icon: 'pie', label: t.navBudget },
    { r: 'settings', icon: 'gear', label: t.navSettings },
  ];
  // Desktop sidebar has room for everything; on mobile, Insights/Reports are reached from
  // Dashboard and Budget, and Exchange from Wallet.
  const sideNav: typeof nav = [
    ...nav.slice(0, 4),
    { r: 'insights', icon: 'trend', label: t.navInsights },
    { r: 'reports', icon: 'file', label: t.navReports },
    { r: 'exchange', icon: 'swap', label: t.navExchange },
    nav[4],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={32} height={32} />
          <span>{t.appName}</span>
        </div>
        <button className="btn btn-primary btn-add-side" onClick={() => setForm({})} data-testid="add-side">
          <Icon name="plus" /> {t.addTransaction}
        </button>
        <nav aria-label="Main">
          {sideNav.map((n) => (
            <a key={n.r} href={`#/${n.r}`} className={`side-link ${route === n.r ? 'active' : ''}`} aria-current={route === n.r ? 'page' : undefined}>
              <Icon name={n.icon} /> {n.label}
            </a>
          ))}
        </nav>
        {lock.config && (
          <button className="btn btn-soft side-lock" onClick={lock.lockNow} data-testid="lock-now-side">
            <Icon name="lock" size={16} /> {t.lockNow}
          </button>
        )}
        <p className="side-privacy"><Icon name="lock" size={14} /> {t.privacyTitle}: 100% on-device</p>
      </aside>

      <main className="main" id="main">
        {!online && (
          <div className="offline-bar" role="status" data-testid="offline-bar">
            <Icon name="wifiOff" size={16} /> {t.offline}
          </div>
        )}
        {sw.needRefresh && (
          <div className="update-bar" role="status">
            <span>{t.updateAvailable}</span>
            <button className="btn btn-primary small" onClick={sw.update}>{t.reload}</button>
          </div>
        )}
        {route === 'dashboard' && <Dashboard onEdit={edit} go={go} />}
        {route === 'transactions' && <Transactions key={sub ?? 'all'} onEdit={edit} initialAccount={sub} />}
        {route === 'wallet' && <Wallet key={sub ?? 'accounts'} initialTab={sub === 'goals' ? 'goals' : 'accounts'} />}
        {route === 'insights' && <Insights />}
        {route === 'budget' && <Budget key={sub ?? 'summary'} initialTab={sub === 'categories' || sub === 'rules' ? sub : 'summary'} />}
        {route === 'exchange' && <Exchange />}
        {route === 'settings' && <Settings go={go} />}
        {route === 'reports' && <Reports />}
      </main>

      <button className="fab" onClick={() => setForm({})} aria-label={t.addTransaction} data-testid="add-fab">
        <Icon name="plus" size={26} />
        <span className="fab-label">{t.addTransaction}</span>
      </button>

      <nav className="tabbar" aria-label="Main">
        {nav.map((n) => (
          <a key={n.r} href={`#/${n.r}`} className={`tab ${route === n.r ? 'active' : ''}`} aria-current={route === n.r ? 'page' : undefined} data-testid={`nav-${n.r}`}>
            <Icon name={n.icon} size={22} />
            <span>{n.label}</span>
          </a>
        ))}
      </nav>

      {form && <TxForm initial={form.tx} defaultType={form.type} onClose={() => setForm(null)} />}
    </div>
  );
}
