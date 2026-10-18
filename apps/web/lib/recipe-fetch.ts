// [MEAL-25] Fetching a recipe link to read its published recipe data (WP-105). The server fetches a
// page an admin typed, so it takes only http and https to a public address, follows at most three
// redirects (each checked again), and gives up after its time and size limits.

import { isIP } from 'node:net';

export interface FetchDeps {
  /** The addresses a host name resolves to. */
  lookup: (host: string) => Promise<string[]>;
  fetch: typeof fetch;
}

export const LIMITS = { timeoutMs: 8000, maxBytes: 2_000_000, redirects: 3 };

export type FetchResult =
  | { ok: true; html: string; url: string }
  | { ok: false; why: 'bad_link' | 'private' | 'unreachable' | 'too_big' | 'not_a_page' };

/** Whether an address is private, local or otherwise not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return (
      s === '::' ||
      s === '::1' ||
      s.startsWith('fc') ||
      s.startsWith('fd') ||
      s.startsWith('fe8') ||
      s.startsWith('fe9') ||
      s.startsWith('fea') ||
      s.startsWith('feb') ||
      s.startsWith('ff')
    );
  }
  return true;
}

async function publicUrl(raw: string, deps: FetchDeps): Promise<URL | 'bad_link' | 'private'> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'bad_link';
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    return 'bad_link';
  if (url.port && url.port !== '80' && url.port !== '443') return 'private';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.local$|\.internal$/i.test(host)) return 'private';
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await deps.lookup(host);
  } catch {
    return 'bad_link';
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) return 'private';
  return url;
}

/** [MEAL-25] A recipe page's HTML, fetched within the limits; or why not. */
export async function fetchRecipePage(raw: string, deps: FetchDeps): Promise<FetchResult> {
  let next = raw;
  const deadline = AbortSignal.timeout(LIMITS.timeoutMs);
  for (let hop = 0; hop <= LIMITS.redirects; hop += 1) {
    const url = await publicUrl(next, deps);
    if (url === 'bad_link' || url === 'private') return { ok: false, why: url };
    let res: Response;
    try {
      res = await deps.fetch(url, {
        redirect: 'manual',
        signal: deadline,
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'user-agent': 'FamilyWise recipe reader',
        },
      });
    } catch {
      return { ok: false, why: 'unreachable' };
    }
    if (res.status >= 300 && res.status < 400) {
      const to = res.headers.get('location');
      if (!to) return { ok: false, why: 'unreachable' };
      next = new URL(to, url).toString();
      continue;
    }
    if (!res.ok) return { ok: false, why: 'unreachable' };
    const type = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(type)) return { ok: false, why: 'not_a_page' };
    if (Number(res.headers.get('content-length') ?? 0) > LIMITS.maxBytes)
      return { ok: false, why: 'too_big' };
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, why: 'unreachable' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMITS.maxBytes) {
          await reader.cancel();
          return { ok: false, why: 'too_big' };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, why: 'unreachable' };
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.byteLength;
    }
    return { ok: true, html: new TextDecoder().decode(bytes), url: url.toString() };
  }
  return { ok: false, why: 'unreachable' };
}
