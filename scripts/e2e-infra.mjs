// [NFR-14][D-104] Tells an infrastructure failure from an assertion failure in an e2e run (01 §9.5).
// Only an infrastructure failure re-runs, once, and only on hard evidence that the test database or
// the preview failed while the test ran:
//
//   - the error names one: a statement timeout, a refused or reset connection, a 5xx gateway answer;
//   - the test's browser saw Supabase answer 5xx, or a statement timeout, or the demo family's day
//     turned after its data was loaded (e2e/support/test.ts records each as an "infra" annotation);
//   - the run's probe of the test database or the preview saw it slow or down while the test ran
//     (scripts/e2e-run.mjs).
//
// Anything else is an assertion failure: it never re-runs.

/** Error text that names a failure of the database, the network or the preview, not of the app. */
export const INFRA_PATTERNS = [
  [
    /canceling statement due to statement timeout|statement timeout|\b57014\b/i,
    'database statement timeout',
  ],
  [
    /ECONNREFUSED|connection refused|could not connect to server|connection to server at .* failed/i,
    'connection refused',
  ],
  [
    /ECONNRESET|connection reset|socket hang up|server closed the connection unexpectedly|terminating connection|SSL SYSCALL error|EPIPE/i,
    'connection reset',
  ],
  [
    /remaining connection slots are reserved|too many connections|max client connections reached/i,
    'database connections full',
  ],
  [/ETIMEDOUT|EAI_AGAIN|ENOTFOUND|getaddrinfo/i, 'network unreachable'],
  [
    /\b(502 Bad Gateway|503 Service Unavailable|504 Gateway Time-?out)\b|FUNCTION_INVOCATION_TIMEOUT|DEPLOYMENT_NOT_READY/i,
    'gateway 5xx',
  ],
];

/** The infrastructure cause an error's text names, or null. */
export function causeInText(text) {
  for (const [re, cause] of INFRA_PATTERNS) if (re.test(text ?? '')) return cause;
  return null;
}

/**
 * Classifies one failed attempt.
 *   failure: { errors: string[], annotations: {type, description}[], start: ms, end: ms }
 *   degraded: [{ at: ms, what: string }] — the probe's bad readings, each covering `slack` ms each side
 * Returns { kind: 'infra' | 'assertion', cause }.
 */
export function classify(failure, degraded = [], slack = 10_000) {
  for (const e of failure.errors) {
    const cause = causeInText(e);
    if (cause) return { kind: 'infra', cause: `${cause} (in the error)` };
  }
  const seen = failure.annotations.filter((a) => a.type === 'infra');
  if (seen.length) return { kind: 'infra', cause: seen[0].description };
  const during = degraded.filter(
    (d) => d.at >= failure.start - slack && d.at <= failure.end + slack,
  );
  if (during.length) {
    const worst = during[0];
    return {
      kind: 'infra',
      cause: `${worst.what} at ${new Date(worst.at).toISOString().slice(11, 19)} UTC, while the test ran`,
    };
  }
  return { kind: 'assertion', cause: 'assertion failure' };
}

/** An error's own words: no colour codes, no code frame, no stack lines (they quote the spec's source). */
export function errorText(e) {
  return (
    String(e?.message ?? e ?? '')
      // eslint-disable-next-line no-control-regex
      .replace(/\u001b\[[0-9;]*m/g, '')
      .split('\n')
      .filter(
        (line) => !/^\s*>?\s*\d+ \|/.test(line) && !/^\s*\|/.test(line) && !/^\s+at /.test(line),
      )
      .join('\n')
      .trim()
  );
}

/** A failed result from Playwright's JSON report, as classify() takes it. */
export function failureOf(result, test) {
  const start = Date.parse(result.startTime);
  const errors = [...(result.errors ?? []), ...(result.error ? [result.error] : [])].map(errorText);
  return {
    errors,
    annotations: [...(test.annotations ?? []), ...(result.annotations ?? [])],
    start,
    end: start + (result.duration ?? 0),
  };
}
