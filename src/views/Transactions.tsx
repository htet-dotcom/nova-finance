import { useDeferredValue, useMemo, useState } from 'react';
import { TxRow } from '../components/TxRow';
import { sortAccounts } from '../lib/accounts';
import { sortCategories } from '../lib/categories';
import type { Transaction, TxType } from '../lib/types';
import { useStore } from '../store';
import { EmptyState, Icon, useFmt } from '../ui';

const PAGE = 100;

export function Transactions({ onEdit, initialAccount }: { onEdit: (tx: Transaction) => void; initialAccount?: string }) {
  const { data, t } = useStore();
  const { date } = useFmt();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | TxType>('all');
  const [cat, setCat] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [acc, setAcc] = useState(initialAccount && data.accounts.some((a) => a.id === initialAccount) ? initialAccount : 'all');
  const accounts = useMemo(() => sortAccounts(data.accounts), [data.accounts]);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const [limit, setLimit] = useState(PAGE);
  const query = useDeferredValue(q.trim().toLocaleLowerCase());
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const filtered = useMemo(() => {
    return data.transactions
      .filter((x) => {
        if (type !== 'all' && x.type !== type) return false;
        if (cat !== 'all' && x.categoryId !== cat) return false;
        if (from && x.date < from) return false;
        if (to && x.date > to) return false;
        if (acc === 'none' ? x.accountId !== null : acc !== 'all' && x.accountId !== acc) return false;
        if (query) {
          const c = cats.get(x.categoryId);
          const hay = `${x.note} ${c?.name ?? ''} ${x.amount} ${x.currency}`.toLocaleLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      .sort((a, z) => (a.date === z.date ? z.createdAt.localeCompare(a.createdAt) : z.date.localeCompare(a.date)));
  }, [data.transactions, type, cat, from, to, query, cats, acc]);

  const groups = useMemo(() => {
    const out: { date: string; items: Transaction[] }[] = [];
    for (const x of filtered.slice(0, limit)) {
      const last = out[out.length - 1];
      if (last?.date === x.date) last.items.push(x);
      else out.push({ date: x.date, items: [x] });
    }
    return out;
  }, [filtered, limit]);

  const hasFilters = q || type !== 'all' || cat !== 'all' || from || to || acc !== 'all';
  const catOptions = sortCategories(data.categories).filter((c) => type === 'all' || c.type === type);

  return (
    <div className="view" data-testid="transactions">
      <div className="view-head">
        <h1 className="title">{t.navTransactions}</h1>
      </div>

      <div className="filters card">
        <label className="search">
          <Icon name="search" size={18} />
          <input type="search" placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t.search} data-testid="tx-search" />
        </label>
        <div className="segmented small">
          {(['all', 'expense', 'income'] as const).map((k) => (
            <button key={k} className={type === k ? 'seg-on' : ''} onClick={() => { setType(k); setCat('all'); }} data-testid={`filter-${k}`}>
              {k === 'all' ? t.filterAll : k === 'income' ? t.income : t.expense}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <select className="input" value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t.category} data-testid="filter-category">
            <option value="all">{t.category}: {t.all}</option>
            {catOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.icon} {c.name}
              </option>
            ))}
          </select>
          {accounts.length > 0 && (
            <select className="input" value={acc} onChange={(e) => setAcc(e.target.value)} aria-label={t.account} data-testid="filter-account">
              <option value="all">{t.account}: {t.all}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
              ))}
              <option value="none">{t.noAccount}</option>
            </select>
          )}
          <label className="mini-field">
            <span>{t.fromDate}</span>
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="filter-from" />
          </label>
          <label className="mini-field">
            <span>{t.toDate}</span>
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="filter-to" />
          </label>
        </div>
        <div className="filter-foot">
          <span className="muted small" data-testid="tx-count">{t.results(filtered.length)}</span>
          {hasFilters && (
            <button className="link-btn" onClick={() => { setQ(''); setType('all'); setCat('all'); setFrom(''); setTo(''); setAcc('all'); }}>
              {t.clearFilters}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title={data.transactions.length ? t.noMatch : t.noTransactions} hint={data.transactions.length ? undefined : t.noTransactionsHint} />
      ) : (
        <>
          {groups.map((g) => (
            <section key={g.date} className="tx-group">
              <h3 className="tx-group-head">{date(g.date, 'day')}</h3>
              <ul className="tx-list card">
                {g.items.map((x) => (
                  <TxRow key={x.id} tx={x} category={cats.get(x.categoryId)} account={x.accountId ? accById.get(x.accountId) : undefined} onClick={() => onEdit(x)} />
                ))}
              </ul>
            </section>
          ))}
          {filtered.length > limit && (
            <button className="btn btn-block" onClick={() => setLimit((l) => l + PAGE)}>
              +{Math.min(PAGE, filtered.length - limit)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
