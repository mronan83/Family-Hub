/**
 * [DEV-01][DEV-02] Boards (WP-05, 01 §5.1, D-40). Pairing gives a board the credential of its own
 * Supabase Auth user; the board keeps it in an httpOnly cookie so it can sign in again on its own
 * when its session lapses (a refresh lost on flaky wifi revokes the session family).
 */
export const BOARD_CREDENTIAL_COOKIE = 'fw_board';
/** The longest a browser keeps a cookie. */
export const BOARD_CREDENTIAL_MAX_AGE = 400 * 24 * 60 * 60;

export interface BoardCredential {
  email: string;
  password: string;
}

const DEVICE_EMAIL = /^device-[0-9a-f-]{36}@devices\.familywise\.invalid$/;
const DEVICE_PASSWORD = /^[0-9a-f]{48}$/;

export function encodeCredential(c: BoardCredential): string {
  return Buffer.from(JSON.stringify([c.email, c.password])).toString('base64url');
}

/** The cookie's credential, or null if it is missing or not one pairing could have made. */
export function decodeCredential(value: string | undefined | null): BoardCredential | null {
  if (!value || value.length > 300) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [email, password] = parsed as unknown[];
    if (typeof email !== 'string' || typeof password !== 'string') return null;
    if (!DEVICE_EMAIL.test(email) || !DEVICE_PASSWORD.test(password)) return null;
    return { email, password };
  } catch {
    return null;
  }
}

/** The digits of a code as typed; spaces and dashes do not matter. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** "1234 5678": easier to read across a room and to type on the board's keypad. */
export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}

export const PAIRING_MESSAGES = {
  short: 'Enter all 8 digits from the admin app.',
  invalid:
    'That code didn’t match. Codes work once, for 10 minutes. Check the digits, or ask for a new code in the admin app.',
  paused: 'Too many codes were tried. Wait 10 minutes, then try again.',
  off: 'Pairing isn’t set up on this deployment.',
  failed: 'Pairing didn’t go through. Try again in a moment.',
} as const;

/** True when a session's claims belong to a board, not an admin. */
export function isDeviceClaims(claims: { app_metadata?: unknown } | null | undefined): boolean {
  return (claims?.app_metadata as { role?: string } | undefined)?.role === 'device';
}
