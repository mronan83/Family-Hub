// [NFR-14][D-110] Tells an infrastructure failure from an assertion failure in an e2e run (01 §9.5).
// Only an infrastructure failure re-runs, once, and only on hard evidence that the test database or
// the preview failed while the test ran:
//
//   - the error names one: a statement timeout, a refused or reset connection, a 5xx gateway answer;
//   - the test's browser saw Supabase answer 5xx, or a statement timeout, or the spec's household's day
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
    /remaining connection slots are reserved|too many connections|max client connections reached|ECHECKOUTTIMEOUT|unable to check out connection from the pool/i,
    'database connections full',
  ],
  [
    /authentication did not complete within|Failed to connect to database/i,
    'database not answering',
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

/** [D-129] The probe's bar: a read of the test database that takes longer is the database slow. */
export const SLOW_READ_MS = 2_000;

/**
 * [NFR-14][D-129][D-135] Infrastructure evidence for a change that missed its latency budget: the
 * reads that would have shown it, each the app's own read of the test database (a board's read of
 * its snapshot, or an admin page's load), returned or still going when the wait ended. Only when
 * every one took longer than the probe's 2 s bar was the database slow under the test; one read
 * under the bar that still didn't show the change is the app's own delay, an assertion failure.
 * `reads`: milliseconds, or null where a late change had no read of its own to time.
 * Returns the evidence in words, or null.
 */
export function slowReads(reads, what = 'reads') {
  if (!reads.length || reads.some((ms) => ms === null || ms <= SLOW_READ_MS)) return null;
  return `the ${what} took ${reads.map((ms) => ms.toLocaleString('en-US')).join(', ')} ms, over the probe's 2 s: the test database slow while the test ran`;
}

/**
 * [NFR-14-q] A missed wait's page loads in words: those that finished, and the one still loading when
 * the wait ended (`out`, timed so far, or null), so the message is never blank.
 */
export function loadWords(done, out) {
  const finished = done.length ? `its reloads took ${done.join(', ')} ms` : 'no reload finished';
  return out === null ? finished : `${finished}, and one was still loading after ${out} ms`;
}

/**
 * [NFR-14][D-135] A reading of the preview's /api/health, which never touches the database: an
 * answer slower than the probe's 2 s bar is the preview itself slow (its functions, not the
 * database), as a 5xx or no answer is the preview down. Returns the bad reading in words, or null.
 */
export function healthReading(status, ms) {
  if (status >= 500) return `the preview answered /api/health with ${status}`;
  if (ms > SLOW_READ_MS) return `the preview took ${ms} ms to answer /api/health`;
  return null;
}

/**
 * [NFR-12-a] A reading of the run's probe of the test database: null when it answered within the
 * probe's 2 s bar, else in words, with how much of it the database spent on the query (`serverMs`,
 * from inside the query, or null where it wasn't reported). A slow reading that was mostly the
 * database's own time is the database busy; one that wasn't is the way to it (the network or the
 * connection pooler), so the next look knows which.
 */
export function probeReading(ms, serverMs) {
  if (ms <= SLOW_READ_MS) return null;
  const inside =
    serverMs === null || serverMs === undefined || Number.isNaN(serverMs)
      ? ''
      : ` (${serverMs} ms of it in the database)`;
  return `the test database took ${ms} ms to answer a probe${inside}`;
}

/**
 * [NFR-12-c] A reading of the preview's GET /api/health/db (WP-113): the preview's own way to the
 * test database, which every save in the admin app takes. Its time as the preview measured it (`ms`
 * in the body) over the probe's 2 s bar, or its call to the database failing (a 5xx), is a bad
 * reading. Anything else is no reading: a 404 (a preview built before the route), a refusal by the
 * deployment's protection, a preview without database settings ("off"), or a gateway's own page.
 */
export function dbHealthReading(status, body) {
  const ms = typeof body?.ms === 'number' ? body.ms : null;
  if (status >= 500 && body?.status === 'failed') {
    const why = typeof body?.error === 'string' ? `: ${redact(body.error).slice(0, 120)}` : '';
    return `the preview could not reach the test database (${status}${why})`;
  }
  if (status === 200 && body?.status === 'ok' && ms !== null && ms > SLOW_READ_MS) {
    return `the preview took ${ms} ms to reach the test database`;
  }
  return null;
}

/**
 * [NFR-12-d] The requests a failed test's browser was still waiting for from the preview when it
 * ended (e2e/support/test.ts: page loads and saves), in words, for the failure's cause: what it was
 * waiting for, not a reason to re-run. `waiting`: [{ what, ms }], the longest first. Null if none.
 */
export function waitingWords(waiting) {
  if (!waiting.length) return null;
  const [first, ...rest] = [...waiting].sort((a, b) => b.ms - a.ms);
  const more = rest.length ? ` (and ${rest.length} more)` : '';
  return `the preview had not answered ${first.what} after ${(first.ms / 1000).toFixed(1)} s${more}`;
}

/**
 * Text with every database connection string hidden. A failed psql call's error names its command,
 * the test database's URL and password with it, and the run summary and the "E2E red on main"
 * issue quote that error: GitHub masks a secret in a job's log, not in an issue it opens.
 */
export function redact(text) {
  return String(text ?? '').replace(/\bpostgres(?:ql)?:\/\/[^\s'"`]+/gi, 'postgresql://***');
}

/**
 * An error's own words: no colour codes, no code frame, no stack lines (they quote the spec's source),
 * and no connection string.
 */
export function errorText(e) {
  return (
    redact(e?.message ?? e ?? '')
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

/** Supabase Auth's sign-ins per IP address in 5 minutes on the free plan (sign_in_sign_ups). */
export const AUTH_SIGN_INS = 30;

/**
 * [NFR-14-z][D-137] The run's sign-ins to Supabase Auth, from the "sign-in" annotations e2e/support
 * makes (signIn(), pairBoard(): "<ISO time> <whose>"), each counted once however many tests carry
 * it: how many, and the most in any 5 minutes, against Auth's limit. Null when there were none.
 */
export function signInWords(annotations, limit = AUTH_SIGN_INS) {
  const times = [
    ...new Set(annotations.filter((a) => a.type === 'sign-in').map((a) => a.description)),
  ]
    .map((d) => Date.parse(d.split(' ')[0]))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (!times.length) return null;
  let most = 0;
  for (let i = 0, j = 0; j < times.length; j++) {
    while (times[j] - times[i] >= 300_000) i++;
    most = Math.max(most, j - i + 1);
  }
  const near = most * 3 > limit * 2 ? ', within a third of it' : '';
  return `${times.length} by e2e/support; at most ${most} in any 5 minutes (Auth allows ${limit} per address${near})`;
}
