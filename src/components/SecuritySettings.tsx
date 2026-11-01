import { useState } from 'react';
import { AUTO_LOCK_CHOICES, isValidPin, PIN_MAX, PIN_MIN } from '../lib/lock';
import { useLock } from '../lock';
import { useStore } from '../store';
import { Icon, Sheet, useToast } from '../ui';

type Flow = 'setup' | 'change' | 'disable';

export function SecuritySettings() {
  const { t } = useStore();
  const lock = useLock();
  const toast = useToast();
  const [flow, setFlow] = useState<Flow | null>(null);
  const cfg = lock.config;

  const toggleBio = async (on: boolean) => {
    try {
      if (on) {
        await lock.enableBiometric();
        toast(t.lockBiometricOn, 'success');
      } else await lock.disableBiometric();
    } catch {
      toast(t.lockBiometricFailed, 'error');
    }
  };

  return (
    <section className="card form" data-testid="security">
      <h2><Icon name="lock" size={18} /> {t.security}</h2>
      {!cfg ? (
        <>
          <p className="small">{t.lockIntro}</p>
          <button className="btn btn-primary" onClick={() => setFlow('setup')} data-testid="lock-setup">{t.lockSetup}</button>
        </>
      ) : (
        <>
          <p className="small"><span className="badge badge-ok">{t.lockOn}</span> {t.lockOnHint}</p>
          {lock.bioAvailable && (
            <label className="check">
              <input type="checkbox" checked={!!cfg.credentialId} onChange={(e) => toggleBio(e.target.checked)} data-testid="lock-bio" />
              <span>{t.lockBiometric}</span>
            </label>
          )}
          <label className="field">
            <span>{t.lockAuto}</span>
            <select className="input" value={cfg.autoLockSeconds} onChange={(e) => lock.update({ autoLockSeconds: Number(e.target.value) })} data-testid="lock-auto">
              {AUTO_LOCK_CHOICES.map((s) => (
                <option key={s} value={s}>{s === 0 ? t.lockImmediately : t.lockAfterMin(s / 60)}</option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={cfg.hideInBackground} onChange={(e) => lock.update({ hideInBackground: e.target.checked })} />
            <span>{t.lockHide}</span>
          </label>
          <div className="btn-grid">
            <button className="btn" onClick={lock.lockNow} data-testid="lock-now">{t.lockNow}</button>
            <button className="btn" onClick={() => setFlow('change')} data-testid="lock-change">{t.lockChange}</button>
            <button className="btn btn-danger-ghost" onClick={() => setFlow('disable')} data-testid="lock-disable">{t.lockDisable}</button>
          </div>
        </>
      )}
      <p className="muted small">{t.lockNote}</p>
      {flow && <PinFlow flow={flow} onClose={() => setFlow(null)} />}
    </section>
  );
}

function PinFlow({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const { t } = useStore();
  const lock = useLock();
  const toast = useToast();
  const needsCurrent = flow !== 'setup';
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (needsCurrent && !(await lock.checkPin(current))) return setError(t.lockWrongCurrent);
      if (flow === 'disable') {
        await lock.disable();
        toast(t.lockDisabled);
        return onClose();
      }
      if (!isValidPin(pin)) return setError(t.lockPinRule(PIN_MIN, PIN_MAX));
      if (pin !== confirmPin) return setError(t.lockPinMismatch);
      await lock.setPin(pin);
      toast(flow === 'setup' ? t.lockEnabled : t.lockChanged, 'success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, testId: string, autoFocus = false) => (
    <label className="field">
      <span>{label}</span>
      <input
        className="input pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={PIN_MAX}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => {
          set(e.target.value.replace(/\D/g, ''));
          setError(null);
        }}
        data-testid={testId}
      />
    </label>
  );

  const title = flow === 'setup' ? t.lockSetup : flow === 'change' ? t.lockChange : t.lockDisable;
  return (
    <Sheet
      title={title}
      onClose={onClose}
      testId="pin-flow"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button type="submit" form="pin-flow" className={`btn ${flow === 'disable' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} data-testid="pin-flow-save">
            {flow === 'disable' ? t.lockDisable : t.save}
          </button>
        </>
      }
    >
      <form id="pin-flow" className="form" onSubmit={submit} noValidate>
        {needsCurrent && field(t.lockCurrentPin, current, setCurrent, 'pin-current', true)}
        {flow !== 'disable' && (
          <>
            {field(t.lockNewPin, pin, setPin, 'pin-new', !needsCurrent)}
            {field(t.lockConfirmPin, confirmPin, setConfirmPin, 'pin-confirm')}
            <small className="muted">{t.lockPinRule(PIN_MIN, PIN_MAX)}</small>
            {flow === 'setup' && <p className="small warn-text">{t.lockForgetWarn}</p>}
          </>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
