// [NFR-14][D-110] Telling an infrastructure failure from an assertion failure (scripts/e2e-infra.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { causeInText, classify, errorText, failureOf, redact } from './e2e-infra.mjs';

const failure = (over = {}) => ({
  errors: [],
  annotations: [],
  start: 1_000_000,
  end: 1_060_000,
  ...over,
});

test('[NFR-14][D-110] the database and network errors that count as infrastructure', () => {
  assert.equal(
    causeInText('ERROR:  canceling statement due to statement timeout'),
    'database statement timeout',
  );
  assert.equal(causeInText('{"code":"57014"}'), 'database statement timeout');
  assert.equal(causeInText('connect ECONNREFUSED 10.0.0.1:5432'), 'connection refused');
  assert.equal(
    causeInText('psql: error: server closed the connection unexpectedly'),
    'connection reset',
  );
  assert.equal(causeInText('read ECONNRESET'), 'connection reset');
  assert.equal(
    causeInText('FATAL: remaining connection slots are reserved'),
    'database connections full',
  );
  assert.equal(causeInText('503 Service Unavailable'), 'gateway 5xx');
  // The pooler with no free connection, and a database too busy to sign a connection in (run 236).
  assert.equal(
    causeInText(
      'FATAL:  (ECHECKOUTTIMEOUT) unable to check out connection from the pool after 15000ms in Session mode',
    ),
    'database connections full',
  );
  assert.equal(
    causeInText(
      'FATAL:  Failed to connect to database: authentication did not complete within 15000ms',
    ),
    'database not answering',
  );
});

test('[NFR-14][D-110] an assertion failure is not infrastructure, however slow', () => {
  assert.equal(causeInText('expect(locator).toHaveText(expected) failed\nTimeout: 15000ms'), null);
  assert.equal(causeInText('Test timeout of 90000ms exceeded.'), null);
  assert.equal(causeInText('Expected: < 3000\nReceived: 5352'), null);
  assert.equal(classify(failure({ errors: ['Expected: < 3000'] })).kind, 'assertion');
});

test('[NFR-14][D-110] the evidence the browser recorded makes it infrastructure', () => {
  const v = classify(
    failure({
      errors: ['expect(locator).toBeVisible() failed'],
      annotations: [
        {
          type: 'infra',
          description:
            'the browser saw Supabase answer 500, a statement timeout to POST /rest/v1/rpc/board_snapshot',
        },
      ],
    }),
  );
  assert.equal(v.kind, 'infra');
  assert.match(v.cause, /board_snapshot/);
  // Only the "infra" annotation counts, not the test's own notes.
  assert.equal(
    classify(failure({ annotations: [{ type: 'DEV-05 latency', description: 'p95 5352 ms' }] }))
      .kind,
    'assertion',
  );
});

test('[NFR-14][D-110] the probe seeing the database slow while the test ran makes it infrastructure', () => {
  const during = [{ at: 1_030_000, what: 'the test database took 4100 ms to answer a probe' }];
  const v = classify(failure({ errors: ['Expected: < 3000'] }), during);
  assert.equal(v.kind, 'infra');
  assert.match(v.cause, /took 4100 ms .* while the test ran/);
  // A slow reading long before or after the test says nothing about it.
  const elsewhere = [
    { at: 500_000, what: 'slow' },
    { at: 2_000_000, what: 'slow' },
  ];
  assert.equal(classify(failure({ errors: ['x'] }), elsewhere).kind, 'assertion');
});

test('[NFR-14][D-110] the code frame in an error never counts, only its own words', () => {
  const message =
    '\u001b[2mexpect(\u001b[22mreceived).toBe(expected)\n\nExpected: 2\nReceived: 1\n\n   10 | test("x", () => {\n>  11 |   throw new Error("server closed the connection unexpectedly");\n     |   ^\n    at /e2e/tests/x.spec.ts:11:3';
  assert.equal(
    errorText({ message }),
    'expect(received).toBe(expected)\n\nExpected: 2\nReceived: 1',
  );
  const result = {
    startTime: new Date(1_000_000).toISOString(),
    duration: 5,
    errors: [{ message }],
    annotations: [],
  };
  assert.equal(classify(failureOf(result, { annotations: [] })).kind, 'assertion');
});

test('[NFR-14][D-110] a failed psql call never puts the database URL or its password in the summary or an issue', () => {
  const message =
    "Command failed: psql postgresql://postgres.ref:pa55-w0rd@pooler.example.com:5432/postgres -X -A -t -q -c delete from public.chore where id = 'x'\nERROR:  completion events are append-only";
  const text = errorText({ message });
  assert.doesNotMatch(text, /pa55-w0rd|pooler\.example\.com/);
  assert.match(text, /^Command failed: psql postgresql:\/\/\*\*\* -X /);
  assert.match(text, /completion events are append-only/);
  assert.equal(
    redact('postgres://u:p@h/db and POSTGRESQL://u:p@h/db'),
    'postgresql://*** and postgresql://***',
  );
  assert.equal(redact('no URL here'), 'no URL here');
});
