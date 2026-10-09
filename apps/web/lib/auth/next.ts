/**
 * [ACC-02] Where to go after signing in. Only a path on this site is followed; anything else (another
 * origin, a protocol-relative `//host`, a backslash trick, a control character) falls back, so a
 * crafted sign-in link cannot send an admin elsewhere.
 */
export function safeNext(raw: unknown, fallback = '/admin'): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'https://familywise.invalid');
    if (url.origin !== 'https://familywise.invalid') return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

/** The sign-in page, coming back to `next` afterwards. */
export function signInPath(next?: string): string {
  const target = safeNext(next, '');
  return target && target !== '/admin' ? `/sign-in?next=${encodeURIComponent(target)}` : '/sign-in';
}
