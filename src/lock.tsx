import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as db from './lib/db';
import { onAppActive } from './native';
import {
  biometricAvailable,
  createLockConfig,
  FREE_ATTEMPTS,
  registerBiometric,
  registerFailure,
  remainingBlockMs,
  verifyBiometric,
  verifyPin,
  type LockAttempts,
  type LockConfig,
} from './lib/lock';
import { useStore } from './store';
import { Icon, useConfirm } from './ui';

interface LockApi {
  /** undefined while loading */
  config: LockConfig | null | undefined;
  locked: boolean;
  bioAvailable: boolean;
  lockNow(): void;
  setPin(pin: string): Promise<void>;
  checkPin(pin: string): Promise<boolean>;
  disable(): Promise<void>;
  enableBiometric(): Promise<void>;
  disableBiometric(): Promise<void>;
  update(patch: Partial<Pick<LockConfig, 'autoLockSeconds' | 'hideInBackground'>>): Promise<void>;
}

const LockCtx = createContext<LockApi | null>(null);

export function useLock(): LockApi {
  const v = useContext(LockCtx);
  if (!v) throw new Error('useLock outside LockProvider');
  return v;
}

export function LockProvider({ children }: { children: ReactNode }) {
  const { t } = useStore();
  const [config, setConfig] = useState<LockConfig | null | undefined>(undefined);
  const [locked, setLocked] = useState(true);
  const [bioAvailable, setBioAvailable] = useState(false);
  const cfgRef = useRef(config);
  cfgRef.current = config;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = (await db.loadLockConfig<LockConfig>()) ?? null;
        if (cancelled) return;
        setConfig(cfg);
        setLocked(!!cfg);
      } catch {
        // Storage problems are reported by the store; never lock the user out because of them.
        if (!cancelled) {
          setConfig(null);
          setLocked(false);
        }
      }
      if (!cancelled) setBioAvailable(await biometricAvailable());
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-lock after time in the background; blur while hidden so the app switcher shows nothing.
  useEffect(() => {
    // Both the page visibility and (in the Android app) the native app state feed
    // these two idempotent handlers, so whichever fires first wins.
    let hiddenAt = 0;
    const goHidden = () => {
      if (hiddenAt) return;
      hiddenAt = Date.now();
      const cfg = cfgRef.current;
      if (cfg?.hideInBackground) document.body.classList.add('privacy-blur');
      if (cfg && cfg.autoLockSeconds === 0) setLocked(true);
    };
    const goVisible = () => {
      document.body.classList.remove('privacy-blur');
      if (!hiddenAt) return;
      const cfg = cfgRef.current;
      if (cfg && Date.now() - hiddenAt >= cfg.autoLockSeconds * 1000) setLocked(true);
      hiddenAt = 0;
    };
    const onVis = () => (document.visibilityState === 'hidden' ? goHidden() : goVisible());
    document.addEventListener('visibilitychange', onVis);
    let off = () => {};
    let disposed = false;
    void onAppActive((active) => (active ? goVisible() : goHidden())).then((f) => (disposed ? f() : (off = f)));
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVis);
      off();
    };
  }, []);

  const save = useCallback(async (cfg: LockConfig | null) => {
    await db.saveLockConfig(cfg);
    setConfig(cfg);
  }, []);

  const api: LockApi = {
    config,
    locked: !!config && locked,
    bioAvailable,
    lockNow: () => cfgRef.current && setLocked(true),
    setPin: async (pin) => {
      await save(await createLockConfig(pin, cfgRef.current ?? undefined));
      await db.saveLockAttempts(null);
      setLocked(false);
    },
    checkPin: async (pin) => !!cfgRef.current && (await verifyPin(cfgRef.current, pin)),
    disable: async () => {
      await save(null);
      await db.saveLockAttempts(null);
      setLocked(false);
    },
    enableBiometric: async () => {
      if (!cfgRef.current) return;
      const credentialId = await registerBiometric(t.lockUseBiometric);
      await save({ ...cfgRef.current, credentialId });
    },
    disableBiometric: async () => {
      if (cfgRef.current) await save({ ...cfgRef.current, credentialId: null });
    },
    update: async (patch) => {
      if (cfgRef.current) await save({ ...cfgRef.current, ...patch });
    },
  };

  if (config === undefined) return <div className="boot" aria-busy="true" />;
  return (
    <LockCtx.Provider value={api}>
      {api.locked ? <LockScreen config={config!} onUnlock={() => setLocked(false)} onReset={() => api.disable()} /> : children}
    </LockCtx.Provider>
  );
}

// ---------------------------------------------------------------------------

function LockScreen({ config, onUnlock, onReset }: { config: LockConfig; onUnlock: () => void; onReset: () => Promise<void> }) {
  const { t, resetAll } = useStore();
  const confirm = useConfirm();
  const [pin, setPin] = useState('');
  const pinRef = useRef('');
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<LockAttempts | undefined>();
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const blocked = remainingBlockMs(attempts, now);

  useEffect(() => {
    void db.loadLockAttempts<LockAttempts>().then(setAttempts);
  }, []);
  useEffect(() => {
    if (!blocked) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [blocked]);

  const submit = useCallback(
    async (value: string) => {
      if (busy || remainingBlockMs(attempts) > 0) return;
      setBusy(true);
      try {
        if (await verifyPin(config, value)) {
          await db.saveLockAttempts(null);
          onUnlock();
          return;
        }
        const next = registerFailure(attempts);
        setAttempts(next);
        await db.saveLockAttempts(next);
        setNow(Date.now());
        pinRef.current = '';
        setPin('');
        const left = FREE_ATTEMPTS - next.failures;
        setError(left > 0 ? t.lockWrongPin(left) : t.lockWrongPinWait);
      } finally {
        setBusy(false);
      }
    },
    [attempts, busy, config, onUnlock, t],
  );

  const press = useCallback(
    (d: string) => {
      if (blocked || busy) return;
      setError(null);
      const cur = pinRef.current;
      if (cur.length >= config.pinLength) return;
      const next = cur + d;
      pinRef.current = next;
      setPin(next);
      if (next.length === config.pinLength) void submit(next);
    },
    [blocked, busy, config.pinLength, submit],
  );
  const back = useCallback(() => {
    pinRef.current = pinRef.current.slice(0, -1);
    setPin(pinRef.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  const bio = async () => {
    if (config.credentialId && (await verifyBiometric(config.credentialId, t.lockUseBiometric))) {
      await db.saveLockAttempts(null);
      onUnlock();
    } else setError(t.lockBiometricFailed);
  };

  const forgot = async () => {
    if (!(await confirm.ask(t.lockForgotConfirm))) return;
    await resetAll();
    await onReset();
  };

  return (
    <div className="lock-screen" data-testid="lock-screen">
      <div className="lock-card">
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={56} height={56} />
        <h1>{t.appName}</h1>
        <p className="muted">{t.lockEnterPin}</p>
        <PinDots length={config.pinLength} filled={pin.length} error={!!error} />
        <p className="lock-error" role="alert" aria-live="assertive">
          {blocked ? t.lockBlocked(Math.ceil(blocked / 1000)) : error ?? ''}
        </p>
        <PinPad onDigit={press} onBack={back} disabled={!!blocked || busy} extra={config.credentialId ? { label: t.lockUseBiometric, icon: 'fingerprint', run: bio } : undefined} />
        <button className="link-btn" onClick={forgot} data-testid="lock-forgot">{t.lockForgot}</button>
      </div>
      {confirm.node}
    </div>
  );
}

export function PinDots({ length, filled, error }: { length: number; filled: number; error?: boolean }) {
  return (
    <div className={`pin-dots ${error ? 'pin-dots-error' : ''}`} aria-hidden="true">
      {Array.from({ length }, (_, i) => (
        <span key={i} className={i < filled ? 'on' : ''} />
      ))}
    </div>
  );
}

export function PinPad({
  onDigit,
  onBack,
  disabled,
  extra,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  disabled?: boolean;
  extra?: { label: string; icon: string; run: () => void };
}) {
  const { t } = useStore();
  return (
    <div className="pin-pad" role="group" aria-label={t.lockPinPad}>
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} type="button" onClick={() => onDigit(d)} disabled={disabled} data-testid={`pin-${d}`}>
          {d}
        </button>
      ))}
      {extra ? (
        <button type="button" onClick={extra.run} aria-label={extra.label} title={extra.label} className="pin-extra" data-testid="pin-biometric">
          <Icon name={extra.icon} size={24} />
        </button>
      ) : (
        <span />
      )}
      <button type="button" onClick={() => onDigit('0')} disabled={disabled} data-testid="pin-0">
        0
      </button>
      <button type="button" onClick={onBack} aria-label={t.lockBackspace} className="pin-extra" data-testid="pin-back">
        ⌫
      </button>
    </div>
  );
}
