import { useMemo, useState } from 'react';
import { buildDailySummary, canNativeShare, copyText, shareText, telegramShareUrl } from '../lib/share';
import { useStore } from '../store';
import { Icon, Sheet, useFmt, useToast } from '../ui';

export function ShareSheet({ onClose }: { onClose: () => void }) {
  const { budget, t, data, today } = useStore();
  const { date } = useFmt();
  const toast = useToast();
  const [failed, setFailed] = useState(false);

  const text = useMemo(
    () =>
      buildDailySummary(
        budget,
        {
          income: t.sumIncome,
          spent: t.sumSpent,
          remaining: t.sumRemaining,
          todayLimit: t.sumTodayLimit,
          todaySpending: t.sumTodaySpending,
          status: t.sumStatus,
          statusOk: t.sumOk,
          statusOver: t.sumOver,
          statusOther: t.sumOther,
          daysLeft: t.sumDaysLeft,
          footer: t.sumFooter,
        },
        date(today, 'long'),
        data.settings.customCurrencies,
      ),
    [budget, t, today, data.settings.customCurrencies, date],
  );

  const native = async () => {
    const r = await shareText(text, t.shareTitle);
    if (r === 'copied') toast(t.copied, 'success');
    if (r === 'failed') setFailed(true);
  };
  const copy = async () => {
    if (await copyText(text)) toast(t.copied, 'success');
    else setFailed(true);
  };

  return (
    <Sheet title={t.shareTitle} onClose={onClose} testId="share-sheet">
      <pre className="share-preview" data-testid="share-text">
        {text}
      </pre>
      {failed && <p className="field-error">{t.shareFailed}</p>}
      <div className="share-actions">
        <button className="btn btn-primary" onClick={native} data-testid="share-native">
          <Icon name="share" size={18} /> {canNativeShare() ? t.share : `${t.share} / ${t.copy}`}
        </button>
        <a className="btn btn-telegram" href={telegramShareUrl(text)} target="_blank" rel="noopener noreferrer" data-testid="share-telegram">
          <Icon name="send" size={18} /> {t.shareTelegram}
        </a>
        <button className="btn" onClick={copy} data-testid="share-copy">
          <Icon name="copy" size={18} /> {t.copy}
        </button>
      </div>
    </Sheet>
  );
}
