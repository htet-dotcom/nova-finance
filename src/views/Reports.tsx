import { useMemo, useRef, useState } from 'react';
import { downloadFiles } from '../download';
import { parts } from '../lib/dates';
import { buildReport, buildReportText, dailyRange, monthlyRange, type Report, type ReportFormatters, type ReportKind, type ReportLabels } from '../lib/report';
import { shareFiles, shareText, copyText } from '../lib/share';
import { reportLabels } from '../i18n';
import { useStore } from '../store';
import { Icon, useFmt, useToast } from '../ui';
import type { ReportFormat } from '../lib/report-render';

type Status =
  | { s: 'idle' }
  | { s: 'working' }
  | { s: 'done'; text: string }
  | { s: 'cancelled'; text: string }
  | { s: 'retry'; text: string }
  | { s: 'fallback'; text: string }
  | { s: 'error'; text: string };

export function Reports() {
  const { data, t, today } = useStore();
  const { money, date, dateTime, monthYear } = useFmt();
  const toast = useToast();
  const { y, m } = parts(today);
  const [kind, setKind] = useState<ReportKind>('daily');
  const [day, setDay] = useState(today);
  const [year, setYear] = useState(y);
  const [month, setMonth] = useState(m);
  const [format, setFormat] = useState<ReportFormat>('pdf');
  const [status, setStatus] = useState<Status>({ s: 'idle' });
  // Files generated for the current selection, reused by "share again" (keeps the user gesture short).
  const cache = useRef<{ report: Report; format: ReportFormat; labels: ReportLabels; files: File[] } | null>(null);

  const range = kind === 'daily' ? dailyRange(day) : monthlyRange(year, month);
  const report: Report = useMemo(
    () => buildReport({ ...data, today }, kind, range),
    [data, today, kind, range.start, range.end], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const labels = useMemo(() => reportLabels(t), [t]);
  const formatters: ReportFormatters = useMemo(
    () => ({
      date: (k) => date(k, 'long'),
      dateTime,
      periodLabel: (r) => (r.kind === 'daily' ? date(r.range.start, 'long') : monthYear(r.range.start)),
    }),
    [date, dateTime, monthYear],
  );
  // `report` is recomputed whenever any data changes, so identity is a safe cache key.
  const cached = () => cache.current?.report === report && cache.current.format === format && cache.current.labels === labels;

  const generate = async (): Promise<File[]> => {
    if (cached()) return cache.current!.files;
    const { generateReportFiles } = await import('../lib/report-render');
    const files = await generateReportFiles({ ...report, generatedAt: new Date().toISOString() }, labels, formatters, format);
    cache.current = { report, format, labels, files };
    return files;
  };

  const run = async (action: 'export' | 'share') => {
    if (status.s === 'working') return;
    if (!cached()) setStatus({ s: 'working' });
    try {
      const files = await generate();
      if (action === 'export') {
        await downloadFiles(files);
        setStatus({ s: 'done', text: t.reportExported(files.length) });
        return;
      }
      const outcome = await shareFiles(files, { title: files[0].name });
      if (outcome === 'shared') setStatus({ s: 'done', text: t.reportShared });
      else if (outcome === 'cancelled') setStatus({ s: 'cancelled', text: t.reportShareCancelled });
      else if (outcome === 'needs-gesture') setStatus({ s: 'retry', text: t.reportShareTapAgain });
      else {
        await downloadFiles(files);
        setStatus({ s: 'fallback', text: outcome === 'unsupported' ? t.reportShareUnsupported : t.reportShareFailed });
      }
    } catch (e) {
      console.error('Report generation failed', (e as Error).name); // no report content in logs
      setStatus({ s: 'error', text: t.reportError });
    }
  };

  const textVersion = () => buildReportText(report, labels, formatters);
  const shareAsText = async () => {
    const r = await shareText(textVersion(), labels.appName);
    if (r === 'copied') toast(t.copied, 'success');
  };
  const copyAsText = async () => {
    if (await copyText(textVersion())) toast(t.copied, 'success');
  };

  const s = report.summary;
  const years = Array.from({ length: 7 }, (_, i) => y - 5 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthName = (mm: number) => monthYear(`${year}-${String(mm).padStart(2, '0')}-01`).replace(/\s*\d{4}\s*/, '').trim() || String(mm);

  return (
    <div className="view" data-testid="reports">
      <div className="view-head">
        <h1 className="title">{t.reportsTitle}</h1>
      </div>

      <section className="card form">
        <div className="segmented" role="tablist">
          {(['daily', 'monthly'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'seg-on' : ''} onClick={() => { setKind(k); setStatus({ s: 'idle' }); }} data-testid={`report-kind-${k}`}>
              {k === 'daily' ? t.reportDaily : t.reportMonthly}
            </button>
          ))}
        </div>
        {kind === 'daily' ? (
          <label className="field">
            <span>{t.reportDate}</span>
            <input type="date" className="input" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} data-testid="report-date" />
          </label>
        ) : (
          <div className="field-row">
            <label className="field">
              <span>{t.reportMonth}</span>
              <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))} data-testid="report-month">
                {months.map((mm) => <option key={mm} value={mm}>{monthName(mm)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>{t.reportYear}</span>
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))} data-testid="report-year">
                {years.map((yy) => <option key={yy} value={yy}>{yy}</option>)}
              </select>
            </label>
          </div>
        )}
        <fieldset className="field">
          <legend>{t.reportFormat}</legend>
          <div className="segmented small">
            {(['pdf', 'png', 'txt'] as const).map((f) => (
              <button key={f} type="button" className={format === f ? 'seg-on' : ''} aria-pressed={format === f} onClick={() => { setFormat(f); setStatus({ s: 'idle' }); }} data-testid={`report-format-${f}`}>
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {format === 'png' && <small className="muted">{t.reportPngNote}</small>}
          {format === 'pdf' && <small className="muted">{t.reportPdfNote}</small>}
        </fieldset>
      </section>

      <section className="card" data-testid="report-preview">
        <div className="card-head">
          <h2>{t.reportPreview}</h2>
          <span className="muted small" data-testid="report-period">{formatters.periodLabel(report)}</span>
        </div>
        <div className="stats">
          <div className="stat stat-income"><span className="stat-label">{t.totalIncome}</span><strong className="stat-value" data-testid="report-income">{money(s.totalIncome)}</strong></div>
          <div className="stat stat-expense"><span className="stat-label">{t.totalExpense}</span><strong className="stat-value" data-testid="report-expense">{money(s.totalExpense)}</strong></div>
          <div className="stat"><span className="stat-label">{t.netBalance}</span><strong className={`stat-value ${s.net < 0 ? 'neg' : ''}`} data-testid="report-net">{money(s.net)}</strong></div>
        </div>
        <p className="muted small" style={{ marginTop: 10 }} data-testid="report-count">
          {report.rows.length ? t.reportTransactions(report.rows.length) : t.reportEmpty}
          {report.expenseByCategory[0] && ` · ${t.highestCategory}: ${report.expenseByCategory[0].name}`}
        </p>
        {s.missingRateCurrencies.length > 0 && (
          <div className="alert alert-near" style={{ marginTop: 10 }}><Icon name="alert" /><p>{t.repMissingRates(s.missingRateCurrencies.join(', '))}</p></div>
        )}
      </section>

      <div className="btn-grid">
        <button className="btn btn-primary" onClick={() => run('export')} disabled={status.s === 'working'} data-testid="report-export">
          <Icon name="download" size={18} /> {t.reportExport} {format.toUpperCase()}
        </button>
        <button className="btn" onClick={() => run('share')} disabled={status.s === 'working'} data-testid="report-share">
          <Icon name="share" size={18} /> {t.reportShare}
        </button>
      </div>

      {status.s !== 'idle' && (
        <div
          className={`alert ${status.s === 'error' ? 'alert-over' : status.s === 'done' ? 'alert-info' : status.s === 'working' ? 'alert-info' : 'alert-near'}`}
          role="status"
          aria-live="polite"
          data-testid="report-status"
          data-state={status.s}
        >
          <Icon name={status.s === 'error' ? 'alert' : status.s === 'done' ? 'check' : 'info'} />
          <p>{status.s === 'working' ? t.reportWorking : status.text}</p>
        </div>
      )}

      {status.s === 'fallback' && (
        <div className="btn-grid" data-testid="report-text-fallback">
          <button className="btn" onClick={shareAsText} data-testid="report-share-text"><Icon name="share" size={18} /> {t.reportShareText}</button>
          <button className="btn" onClick={copyAsText} data-testid="report-copy-text"><Icon name="copy" size={18} /> {t.reportCopyText}</button>
        </div>
      )}

      <p className="muted small center"><Icon name="lock" size={14} /> {t.reportPrivacy}</p>
    </div>
  );
}
