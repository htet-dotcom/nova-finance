import { useRef, useState } from 'react';
import { ImportDialog } from '../components/ImportDialog';
import { backupFileName, buildBackup, buildCsv } from '../lib/backup';
import { allCurrencies, BUILTIN_CURRENCIES, CURRENCY_CODE_RE } from '../lib/currency';
import { useStore } from '../store';
import { Icon, useConfirm, useFmt, useToast } from '../ui';
import { useInstallPrompt } from '../pwa';
import { downloadText as download } from '../download';

declare const __APP_VERSION__: string;

const BACKUP_STALE_MS = 14 * 24 * 60 * 60 * 1000;

export function Settings({ go }: { go: (route: string) => void }) {
  const { data, t, updateSettings, markBackedUp, snapshotAt, undoImport, resetAll, persistent } = useStore();
  const { dateTime } = useFmt();
  const toast = useToast();
  const confirm = useConfirm();
  const install = useInstallPrompt();
  const s = data.settings;
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<{ name: string; text: string } | null>(null);
  const [cc, setCc] = useState({ code: '', name: '', symbol: '', decimals: '2' });
  const [ccError, setCcError] = useState(false);
  const currencies = allCurrencies(s.customCurrencies);

  const exportJson = async () => {
    const json = JSON.stringify(buildBackup(data, __APP_VERSION__), null, 2);
    download(backupFileName('json'), json, 'application/json');
    await markBackedUp();
    toast(t.exported, 'success');
  };
  const shareJson = async () => {
    const json = JSON.stringify(buildBackup(data, __APP_VERSION__), null, 2);
    const file = new File([json], backupFileName('json'), { type: 'application/json' });
    try {
      await navigator.share({ files: [file], title: 'Nova Finance backup' });
      await markBackedUp();
      toast(t.exported, 'success');
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') toast((e as Error).message, 'error');
    }
  };
  const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [new File(['x'], 'x.json', { type: 'application/json' })] });
  const exportCsv = () => {
    download(backupFileName('csv'), buildCsv(data), 'text/csv;charset=utf-8');
    toast(t.exported, 'success');
  };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const text = f.size > 25 * 1024 * 1024 ? '' : await f.text();
    setImporting({ name: f.name, text });
  };

  const addCurrency = () => {
    const code = cc.code.trim().toUpperCase();
    const decimals = Number(cc.decimals);
    if (!CURRENCY_CODE_RE.test(code) || currencies.some((c) => c.code === code) || !(decimals >= 0 && decimals <= 4)) return setCcError(true);
    updateSettings({
      customCurrencies: [...s.customCurrencies, { code, name: cc.name.trim() || code, symbol: cc.symbol.trim() || code, decimals: Math.trunc(decimals) }],
      enabledCurrencies: [...s.enabledCurrencies, code],
    });
    setCc({ code: '', name: '', symbol: '', decimals: '2' });
    setCcError(false);
  };

  const stale = !s.lastBackupAt || Date.now() - Date.parse(s.lastBackupAt) > BACKUP_STALE_MS;

  return (
    <div className="view" data-testid="settings">
      <div className="view-head">
        <h1 className="title">{t.navSettings}</h1>
      </div>

      <section className="card privacy" data-testid="privacy">
        <h2><Icon name="lock" size={18} /> {t.privacyTitle}</h2>
        <p className="small">{t.privacyText}</p>
        {persistent !== null && <p className="muted small">{persistent ? t.storagePersistent : t.storageBestEffort}</p>}
      </section>

      <section className="card form">
        <h2>{t.general}</h2>
        <label className="field">
          <span>{t.language}</span>
          <div className="segmented small">
            <button className={s.language === 'en' ? 'seg-on' : ''} onClick={() => updateSettings({ language: 'en' })} data-testid="lang-en">English</button>
            <button className={s.language === 'my' ? 'seg-on' : ''} onClick={() => updateSettings({ language: 'my' })} data-testid="lang-my">မြန်မာ</button>
          </div>
        </label>
        <label className="field">
          <span>{t.theme}</span>
          <div className="segmented small">
            {(['system', 'light', 'dark'] as const).map((k) => (
              <button key={k} className={s.theme === k ? 'seg-on' : ''} onClick={() => updateSettings({ theme: k })} data-testid={`theme-${k}`}>
                {{ system: t.themeSystem, light: t.themeLight, dark: t.themeDark }[k]}
              </button>
            ))}
          </div>
        </label>
        <label className="field">
          <span>{t.primaryCurrency}</span>
          <select className="input" value={s.primaryCurrency} onChange={(e) => updateSettings({ primaryCurrency: e.target.value })} data-testid="primary-currency">
            {currencies.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}
          </select>
          <small className="muted">{t.primaryCurrencyHint}</small>
        </label>
        <button className="btn btn-soft" onClick={() => go('budget/categories')} data-testid="manage-categories">
          {t.manageCategories}
        </button>
      </section>

      <section className="card form">
        <h2>{t.currencies}</h2>
        <div className="chips">
          {currencies.map((c) => {
            const on = s.enabledCurrencies.includes(c.code);
            return (
              <button key={c.code} className={`chip ${on ? 'chip-on' : ''}`} aria-pressed={on} disabled={c.code === s.primaryCurrency}
                onClick={() => updateSettings({ enabledCurrencies: on ? s.enabledCurrencies.filter((x) => x !== c.code) : [...s.enabledCurrencies, c.code] })}>
                {c.code}
              </button>
            );
          })}
        </div>
        <details>
          <summary>{t.addCurrency}</summary>
          <div className="field-row wrap">
            <label className="field"><span>{t.customCurrencyCode}</span><input className="input" maxLength={3} value={cc.code} onChange={(e) => setCc({ ...cc, code: e.target.value.toUpperCase() })} data-testid="cc-code" /></label>
            <label className="field"><span>{t.customCurrencyName}</span><input className="input" maxLength={60} value={cc.name} onChange={(e) => setCc({ ...cc, name: e.target.value })} /></label>
            <label className="field"><span>{t.customCurrencySymbol}</span><input className="input" maxLength={8} value={cc.symbol} onChange={(e) => setCc({ ...cc, symbol: e.target.value })} /></label>
            <label className="field"><span>{t.customCurrencyDecimals}</span><input className="input" inputMode="numeric" maxLength={1} value={cc.decimals} onChange={(e) => setCc({ ...cc, decimals: e.target.value })} /></label>
          </div>
          {ccError && <p className="field-error">{t.invalidCurrency}</p>}
          <button className="btn btn-soft" onClick={addCurrency} data-testid="cc-add">{t.addCurrency}</button>
          {s.customCurrencies.length > 0 && (
            <ul className="rate-list">
              {s.customCurrencies.map((c) => (
                <li key={c.code} className="rate-item">
                  <span className="grow">{c.code} – {c.name} ({c.symbol})</span>
                  {!BUILTIN_CURRENCIES.some((b) => b.code === c.code) && c.code !== s.primaryCurrency && (
                    <button className="icon-btn" aria-label={t.delete} onClick={() => updateSettings({ customCurrencies: s.customCurrencies.filter((x) => x.code !== c.code), enabledCurrencies: s.enabledCurrencies.filter((x) => x !== c.code) })}>
                      <Icon name="trash" size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </details>
        <label className="check">
          <input type="checkbox" checked={s.rateProviderEnabled} onChange={(e) => updateSettings({ rateProviderEnabled: e.target.checked })} data-testid="provider-toggle" />
          <span>{t.useProvider}</span>
        </label>
      </section>

      <section className="card form" data-testid="backup">
        <h2>{t.backupTitle}</h2>
        <p className={stale ? 'warn-text' : ''} data-testid="last-backup">
          {t.lastBackup}: <strong>{s.lastBackupAt ? dateTime(s.lastBackupAt) : t.never}</strong>
        </p>
        {stale && data.transactions.length > 0 && <p className="small warn-text">{t.backupReminder}</p>}
        <div className="btn-grid">
          <button className="btn btn-primary" onClick={exportJson} data-testid="export-json"><Icon name="download" size={18} /> {t.exportJson}</button>
          {canShareFiles && <button className="btn" onClick={shareJson} data-testid="share-json"><Icon name="share" size={18} /> {t.share} JSON</button>}
          <button className="btn" onClick={exportCsv} data-testid="export-csv"><Icon name="download" size={18} /> {t.exportCsv}</button>
          <button className="btn" onClick={() => fileRef.current?.click()} data-testid="import-json"><Icon name="upload" size={18} /> {t.importJson}</button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} data-testid="import-file" />
        {snapshotAt && (
          <div className="undo-row">
            <span className="muted small">{t.undoAvailable(dateTime(snapshotAt))}</span>
            <button className="btn btn-soft small" onClick={async () => (await undoImport()) && toast(t.undoDone)} data-testid="undo-import">{t.undoImport}</button>
          </div>
        )}
        <p className="muted small">{t.backupNote}</p>
      </section>

      {install.available && (
        <section className="card">
          <h2>{t.install}</h2>
          <p className="muted small">{t.installHint}</p>
          <button className="btn btn-primary" onClick={install.prompt}>{t.install}</button>
        </section>
      )}

      <section className="card">
        <h2>{t.dangerZone}</h2>
        <button className="btn btn-danger-ghost" data-testid="reset-all" onClick={async () => {
          if (await confirm.ask(t.resetConfirm)) {
            await resetAll();
            toast(t.resetDone);
          }
        }}>
          <Icon name="trash" size={18} /> {t.resetAll}
        </button>
      </section>

      <p className="muted small center">
        {t.appName} · {t.version} {__APP_VERSION__}
      </p>

      {importing && <ImportDialog fileName={importing.name} text={importing.text} onClose={() => setImporting(null)} />}
      {confirm.node}
    </div>
  );
}
