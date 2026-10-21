// [NFR-14][D-110] Telling an infrastructure failure from an assertion failure (scripts/e2e-infra.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  causeInText,
  classify,
  dbHealthReading,
  errorText,
  failureOf,
  healthReading,
  loadWords,
  probeReading,
  redact,
  signInWords,
  slowReads,
  waitingWords,
} from './e2e-infra.mjs';
import { causeOf } from './e2e-run.mjs';

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

test('[NFR-14-a][D-110] a failed psql call never puts the database URL or its password in the summary or an issue', () => {
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

test('[NFR-14-p][D-129] a late change is the database slow only when every read of it took over 2 s', () => {
  // 10de2f5's DEV-05 window: each late change's read slow.
  assert.equal(
    slowReads([11_469, 4_388, 2_001], "board's reads of its late changes"),
    "the board's reads of its late changes took 11,469, 4,388, 2,001 ms, over the probe's 2 s: the test database slow while the test ran",
  );
  // One read back in time that still didn't show the change is the app's own delay.
  assert.equal(slowReads([11_469, 2_000]), null);
  assert.equal(slowReads([11_469, 900]), null);
  // A late change with no read of its own to time is no evidence.
  assert.equal(slowReads([11_469, null]), null);
  assert.equal(slowReads([]), null);
  // Its verdict: infrastructure, with the evidence as its cause.
  const evidence = slowReads([4_542, 4_961]);
  assert.deepEqual(classify(failure({ annotations: [{ type: 'infra', description: evidence }] })), {
    kind: 'infra',
    cause: evidence,
  });
});

test('[NFR-14-q][D-135] a missed page wait says each load, the one still loading included, and is evidence only if all were slow', () => {
  // 8ed3d23's MEAL-09: the first reload still out at 3 s. The message was "took  ms".
  assert.equal(loadWords([], 3_104), 'no reload finished, and one was still loading after 3104 ms');
  assert.equal(loadWords([812, 950], null), 'its reloads took 812, 950 ms');
  assert.equal(
    loadWords([812], 2_190),
    'its reloads took 812 ms, and one was still loading after 2190 ms',
  );
  assert.equal(
    slowReads([3_104], 'loads of Meals in the admin app'),
    "the loads of Meals in the admin app took 3,104 ms, over the probe's 2 s: the test database slow while the test ran",
  );
  // A load back within 2 s without the change: the app's delay, an assertion failure.
  assert.equal(slowReads([812, 2_190], 'loads of Meals in the admin app'), null);
});

test('[NFR-14-r][D-135] the preview answering /api/health in over 2 s, or with a 5xx, is a bad reading', () => {
  assert.equal(healthReading(200, 340), null);
  assert.equal(healthReading(200, 2_000), null);
  assert.equal(healthReading(200, 2_473), 'the preview took 2473 ms to answer /api/health');
  assert.equal(healthReading(503, 120), 'the preview answered /api/health with 503');
  // A bad reading while a test ran makes its failure infrastructure.
  const at = failure().start + 5_000;
  assert.equal(classify(failure(), [{ at, what: healthReading(200, 2_473) }]).kind, 'infra');
});

test('[NFR-14-z] the run counts its sign-ins once each, and the most in any 5 minutes against Auth’s limit', () => {
  const at = (min, whose) => ({
    type: 'sign-in',
    description: `${new Date(Date.UTC(2026, 9, 18, 3, 0) + min * 60_000).toISOString()} ${whose}`,
  });
  const a = [
    at(0, 'alex+board'),
    at(0, 'alex+board'),
    at(1, 'board Hall e2e'),
    at(4.9, 'sam+board'),
  ];
  // The same sign-in on several tests (a beforeAll's) counts once; 4.9 minutes is within 5.
  assert.equal(
    signInWords([...a, at(10, 'alex+chores'), { type: 'limit', description: '90000' }]),
    '4 by e2e/support; at most 3 in any 5 minutes (Auth allows 30 per address)',
  );
  const busy = Array.from({ length: 21 }, (_, i) => at(i * 0.2, `alex+s${i}`));
  assert.match(signInWords(busy), /at most 21 in any 5 minutes .*within a third of it/);
  assert.equal(signInWords([{ type: 'infra', description: 'x' }]), null);
});

test('[NFR-12-a] a slow probe says how much of it the database spent on the query', () => {
  assert.equal(probeReading(1_999, 3), null);
  assert.equal(probeReading(2_000, 3), null);
  assert.equal(
    probeReading(3_571, 4),
    'the test database took 3571 ms to answer a probe (4 ms of it in the database)',
  );
  assert.equal(
    probeReading(2_664, 2_610),
    'the test database took 2664 ms to answer a probe (2610 ms of it in the database)',
  );
  // An answer without the query's own time (an older probe line) still counts as slow.
  assert.equal(probeReading(2_500, NaN), 'the test database took 2500 ms to answer a probe');
  assert.equal(probeReading(2_500, null), 'the test database took 2500 ms to answer a probe');
});

test('[NFR-12-c] the preview slow to reach the test database, or not reaching it, is a bad reading; a failure while it was is infrastructure', () => {
  assert.equal(dbHealthReading(200, { status: 'ok', ms: 40 }), null);
  assert.equal(dbHealthReading(200, { status: 'ok', ms: 2_000 }), null);
  assert.equal(
    dbHealthReading(200, { status: 'ok', ms: 4_210 }),
    'the preview took 4210 ms to reach the test database',
  );
  assert.equal(
    dbHealthReading(503, {
      status: 'failed',
      ms: 8_001,
      error: 'canceling statement due to statement timeout',
    }),
    'the preview could not reach the test database (503: canceling statement due to statement timeout)',
  );
  assert.equal(
    dbHealthReading(503, {
      status: 'failed',
      error: 'at postgresql://u:secret@db.example/postgres',
    }),
    'the preview could not reach the test database (503: at postgresql://***)',
  );
  // No reading, not a bad one: a preview built before the route, the deployment's protection
  // refusing, a preview without database settings, a gateway's own page (the preview probe's to say).
  assert.equal(dbHealthReading(404, { error: 'not found' }), null);
  assert.equal(dbHealthReading(401, null), null);
  assert.equal(dbHealthReading(403, null), null);
  assert.equal(dbHealthReading(503, { status: 'off', error: 'no database settings' }), null);
  assert.equal(dbHealthReading(504, null), null);
  // Such a reading during a save that never answered makes the failure infrastructure.
  const at = 1_030_000;
  assert.deepEqual(
    classify(failure(), [{ at, what: 'the preview took 4210 ms to reach the test database' }]),
    {
      kind: 'infra',
      cause: `the preview took 4210 ms to reach the test database at ${new Date(at).toISOString().slice(11, 19)} UTC, while the test ran`,
    },
  );
});

test('[NFR-12-d] a failed test still waiting for a page load or a save says which in its cause, and stays an assertion failure', () => {
  assert.equal(waitingWords([]), null);
  assert.equal(
    waitingWords([{ what: 'a save (POST /admin/school/42)', ms: 15_312 }]),
    'the preview had not answered a save (POST /admin/school/42) after 15.3 s',
  );
  assert.equal(
    waitingWords([
      { what: 'the page load of /board', ms: 2_000 },
      { what: 'a save (POST /admin/goals/new)', ms: 16_049 },
    ]),
    'the preview had not answered a save (POST /admin/goals/new) after 16.0 s (and 1 more)',
  );
  const red = {
    verdict: classify(failure()),
    result: {
      errors: [{ message: 'Error: expect(locator).toHaveText(expected) failed\n\nLocator: x' }],
      annotations: [
        {
          type: 'waiting',
          description: JSON.stringify({ what: 'a save (POST /admin/meals)', ms: 15_100 }),
        },
        { type: 'waiting', description: 'not JSON' },
      ],
    },
    test: { annotations: [] },
  };
  assert.equal(red.verdict.kind, 'assertion');
  assert.equal(
    causeOf(red),
    'Error: expect(locator).toHaveText(expected) failed; the preview had not answered a save (POST /admin/meals) after 15.1 s',
  );
  // Nothing waited for: the assertion's own first line, as before.
  assert.equal(
    causeOf({ ...red, result: { ...red.result, annotations: [] } }),
    'Error: expect(locator).toHaveText(expected) failed',
  );
});
