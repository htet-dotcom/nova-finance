import type { Category, Transaction } from '../lib/types';
import { useStore } from '../store';
import { useFmt } from '../ui';

export function TxRow({ tx, category, onClick }: { tx: Transaction; category?: Category; onClick: () => void }) {
  const { t, today } = useStore();
  const { money, date } = useFmt();
  const sign = tx.type === 'income' ? 1 : -1;
  return (
    <li>
      <button className="tx-row" onClick={onClick} data-testid="tx-row">
        <span className="tx-icon" style={{ background: `${category?.color ?? '#64748b'}22` }} aria-hidden="true">
          {category?.icon ?? '❓'}
        </span>
        <span className="tx-main">
          <span className="tx-title">{category?.name ?? '—'}</span>
          <span className="tx-sub">
            {date(tx.date, 'day')}
            {tx.note && ` · ${tx.note}`}
            {tx.recurring && ` · ↻ ${tx.recurring.freq === 'weekly' ? t.weekly : t.monthly}`}
            {tx.date > today && ` · ${t.futureBadge}`}
          </span>
        </span>
        <span className={`tx-amount ${tx.type === 'income' ? 'pos' : 'neg'}`}>
          {money(sign * tx.amount, tx.currency, { signed: true })}
          <span className="tx-cur">{tx.currency}</span>
        </span>
      </button>
    </li>
  );
}
