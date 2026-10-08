import { useMemo, useState } from 'react';
import { parseBackup, planImport, type ParseResult } from '../lib/backup';
import { useStore } from '../store';
import { Icon, Sheet, useFmt, useToast } from '../ui';

export function ImportDialog({ fileName, text, onClose }: { fileName: string; text: string; onClose: () => void }) {
  const { data, t, applyImport, undoImport } = useStore();
  const { dateTime } = useFmt();
  const toast = useToast();
  const parsed: ParseResult = useMemo(() => parseBackup(text), [text]);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const plan = useMemo(() => (parsed.ok ? planImport(data, parsed.backup.data, mode) : null), [parsed, data, mode]);

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      await applyImport(plan);
      toast(t.importDone, 'success', {
        label: t.undoImport,
        run: async () => {
          if (await undoImport()) toast(t.undoDone);
        },
      });
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sum = (k: 'added' | 'updated' | 'removed') => (plan ? plan.stats.transactions[k] + plan.stats.categories[k] + plan.stats.rates[k] : 0);

  return (
    <Sheet
      title={t.importTitle}
      onClose={onClose}
      testId="import-dialog"
      footer={
        <>
          <button className="btn" onClick={onClose}>{t.cancel}</button>
          {parsed.ok && (
            <button className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} onClick={run} disabled={busy} data-testid="import-confirm">
              {t.confirm}
            </button>
          )}
        </>
      }
    >
      <p className="muted small">📄 {fileName}</p>
      {!parsed.ok ? (
        <div className="alert alert-over" role="alert" data-testid="import-errors">
          <Icon name="alert" />
          <div>
            <strong>{t.importInvalid}</strong>
            <ul className="error-list">
              {parsed.errors.map((e, i) => (
                <li key={i}><code>{e.path}</code>: {e.message}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="form">
          <div className="alert alert-info">
            <Icon name="check" />
            <div>
              <strong>{t.importFrom(dateTime(parsed.backup.exportedAt))}</strong>
              <p data-testid="import-summary">{t.importSummary(parsed.backup.data.transactions.length, parsed.backup.data.categories.length, parsed.backup.data.rates.length)}</p>
              {parsed.warnings.map((w) => <p key={w} className="small muted">{w}</p>)}
            </div>
          </div>
          <fieldset className="field">
            <legend>{t.importMode}</legend>
            <label className="radio">
              <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} data-testid="import-merge" />
              <span>{t.importMerge}</span>
            </label>
            <label className="radio">
              <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} data-testid="import-replace" />
              <span>{t.importReplace}</span>
            </label>
          </fieldset>
          {mode === 'replace' && <p className="field-error">{t.importReplaceWarn}</p>}
          <p className="preview" data-testid="import-changes">{t.importChanges(sum('added'), sum('updated'), sum('removed'))}</p>
        </div>
      )}
    </Sheet>
  );
}
