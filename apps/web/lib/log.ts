/**
 * [NFR-07] Structured logs: one JSON object per line, which Vercel's runtime logs keep (an hour on
 * Hobby; errors also go to private.app_error, `lib/errors.ts`). No PII (NFR-05): fields that could
 * hold it are redacted, and messages lose email addresses and long tokens.
 */
type Level = 'info' | 'warn' | 'error';

const REDACT = /(authorization|cookie|token|secret|password|email|display_?name)$/i;

/** A message with email addresses, bearer tokens and long opaque strings removed. */
export function scrub(message: string): string {
  return (
    message
      .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
      .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
      // Long opaque strings (keys, JWT segments), but not UUIDs, which identify rows and are not PII.
      .replace(/\b(?![0-9a-f]{8}-[0-9a-f]{4}-)[A-Za-z0-9_\-+/=]{32,}\b/g, '[redacted]')
      .slice(0, 1000)
  );
}

function clean(value: unknown, key = ''): unknown {
  if (REDACT.test(key)) return '[redacted]';
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
  if (typeof value === 'string') return scrub(value).slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => clean(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v, k)]));
  }
  return value;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    msg,
    time: new Date().toISOString(),
    ...(clean(fields) as object),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
