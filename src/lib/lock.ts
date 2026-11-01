// App lock: PIN hashing, attempt throttling and optional device biometrics (WebAuthn).
//
// Scope, stated honestly: the lock keeps other people who pick up the device out of the
// app UI. It does not encrypt the IndexedDB data, so it is not protection against someone
// with full access to the browser profile.

export const PIN_MIN = 4;
export const PIN_MAX = 8;
const ITERATIONS = 210_000;

export interface LockConfig {
  v: 1;
  salt: string;
  hash: string;
  iterations: number;
  /** Number of digits, so the keypad can submit as soon as the PIN is complete. */
  pinLength: number;
  /** WebAuthn credential id (base64url) when biometric unlock is enabled. */
  credentialId: string | null;
  /** Lock again after the app has been in the background this long. 0 = immediately. */
  autoLockSeconds: number;
  /** Blur the app while it is in the background / app switcher. */
  hideInBackground: boolean;
}

export interface LockAttempts {
  failures: number;
  /** Epoch ms until which no new attempt is accepted. */
  blockedUntil: number;
}

export const AUTO_LOCK_CHOICES = [0, 60, 300, 900] as const;

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);
}

const enc = new TextEncoder();

export function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toB64(bits);
}

export async function createLockConfig(pin: string, prev?: Partial<LockConfig>, iterations = ITERATIONS): Promise<LockConfig> {
  if (!isValidPin(pin)) throw new Error('invalid-pin');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    v: 1,
    salt: toB64(salt),
    hash: await derive(pin, salt, iterations),
    iterations,
    pinLength: pin.length,
    credentialId: prev?.credentialId ?? null,
    autoLockSeconds: prev?.autoLockSeconds ?? 60,
    hideInBackground: prev?.hideInBackground ?? true,
  };
}

/** Constant-time comparison of two equal-length strings. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(cfg: LockConfig, pin: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  return safeEqual(await derive(pin, fromB64(cfg.salt), cfg.iterations), cfg.hash);
}

/** Free attempts before the waiting time starts. */
export const FREE_ATTEMPTS = 5;

/** After 5 failures: 30 s, then doubling, capped at 15 minutes. */
export function registerFailure(prev: LockAttempts | undefined, now = Date.now()): LockAttempts {
  const failures = (prev?.failures ?? 0) + 1;
  const over = failures - FREE_ATTEMPTS;
  const wait = over > 0 ? Math.min(15 * 60_000, 30_000 * 2 ** (over - 1)) : 0;
  return { failures, blockedUntil: wait ? now + wait : 0 };
}

export function remainingBlockMs(a: LockAttempts | undefined, now = Date.now()): number {
  return a ? Math.max(0, a.blockedUntil - now) : 0;
}

// ---------------------------------------------------------------------------
// Biometrics (platform authenticator: fingerprint, face, Windows Hello, device PIN)
// ---------------------------------------------------------------------------

export async function biometricAvailable(): Promise<boolean> {
  try {
    return (
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof PublicKeyCredential !== 'undefined' &&
      (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
    );
  } catch {
    return false;
  }
}

/** Register a device credential; returns its id. Throws if the user cancels. */
export async function registerBiometric(): Promise<string> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Nova Finance' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'nova-finance', displayName: 'Nova Finance' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  return toB64(cred.rawId);
}

/** Ask the device to verify the user with the registered credential. */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(credentialId) }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return !!res;
  } catch {
    return false;
  }
}
