import { useState } from 'react';
import { sortCategories } from '../lib/categories';
import { parseAmount } from '../lib/currency';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../lib/defaults';
import type { Category, TxType } from '../lib/types';
import { categoryErrorText, useStore } from '../store';
import { Sheet, useToast } from '../ui';

export function CategoryEditor({ initial, type, onClose }: { initial?: Category; type: TxType; onClose: () => void }) {
  const { data, t, saveCategory, deleteCategory } = useStore();
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? CATEGORY_ICONS[0]);
  const [color, setColor] = useState(initial?.color ?? CATEGORY_COLORS[data.categories.length % CATEGORY_COLORS.length]);
  const [budget, setBudget] = useState(initial?.budget ? String(initial.budget) : '');
  const [fixed, setFixed] = useState(initial?.fixed ?? false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const others = sortCategories(data.categories, type).filter((c) => c.id !== initial?.id);
  const [reassign, setReassign] = useState(others[others.length - 1]?.id ?? '');
  const usage = initial ? data.transactions.filter((x) => x.categoryId === initial.id).length : 0;

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const b = budget.trim() === '' ? null : parseAmount(budget);
    if (budget.trim() !== '' && b === null) return setError(t.errInvalidBudget);
    try {
      await saveCategory({ id: initial?.id, name, type, icon, color, budget: b, fixed });
      toast(t.saved, 'success');
      onClose();
    } catch (err) {
      setError(categoryErrorText(t, err));
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await deleteCategory(initial.id, reassign);
      toast(t.deleted);
      onClose();
    } catch (err) {
      setError(categoryErrorText(t, err));
    }
  };

  return (
    <Sheet
      title={initial ? t.editCategory : t.newCategory}
      onClose={onClose}
      testId="category-editor"
      footer={
        deleting ? (
          <>
            <button className="btn" onClick={() => setDeleting(false)}>{t.cancel}</button>
            <button className="btn btn-danger" onClick={remove} data-testid="cat-delete-confirm">{t.delete}</button>
          </>
        ) : (
          <>
            {initial && (
              <button className="btn btn-danger-ghost" onClick={() => (others.length ? setDeleting(true) : setError(t.errLastOfType))} data-testid="cat-delete">
                {t.delete}
              </button>
            )}
            <span className="spacer" />
            <button className="btn" onClick={onClose}>{t.cancel}</button>
            <button className="btn btn-primary" type="submit" form="cat-form" data-testid="cat-save">{t.save}</button>
          </>
        )
      }
    >
      {deleting ? (
        <div className="form">
          <p>{t.deleteCategoryMsg(usage)}</p>
          <select className="input" value={reassign} onChange={(e) => setReassign(e.target.value)} data-testid="cat-reassign">
            {others.map((c) => (
              <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
            ))}
          </select>
          {error && <p className="field-error">{error}</p>}
        </div>
      ) : (
        <form id="cat-form" className="form" onSubmit={save} noValidate>
          <div className="cat-preview">
            <span className="tx-icon big" style={{ background: `${color}22` }}>{icon}</span>
            <label className="field grow">
              <span>{t.name}</span>
              <input className="input" value={name} maxLength={60} onChange={(e) => { setName(e.target.value); setError(null); }} autoFocus={!initial} data-testid="cat-name" />
            </label>
          </div>
          {error && <p className="field-error" role="alert">{error}</p>}
          <fieldset className="field">
            <legend>{t.icon}</legend>
            <div className="icon-grid">
              {CATEGORY_ICONS.map((i) => (
                <button type="button" key={i} className={`icon-pick ${i === icon ? 'on' : ''}`} onClick={() => setIcon(i)} aria-pressed={i === icon} aria-label={i}>
                  {i}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>{t.color}</legend>
            <div className="color-row">
              {CATEGORY_COLORS.map((c) => (
                <button type="button" key={c} className={`color-pick ${c === color ? 'on' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} aria-pressed={c === color} />
              ))}
            </div>
          </fieldset>
          {type === 'expense' && (
            <>
              <label className="field">
                <span>{t.categoryBudget} ({data.settings.primaryCurrency}, {t.optional})</span>
                <input className="input" inputMode="decimal" value={budget} placeholder={t.noBudget} onChange={(e) => setBudget(e.target.value)} data-testid="cat-budget" />
              </label>
              <label className="check">
                <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} data-testid="cat-fixed" />
                <span>
                  {t.fixedCost}
                  <small className="muted block">{t.fixedCostHint}</small>
                </span>
              </label>
            </>
          )}
        </form>
      )}
    </Sheet>
  );
}
