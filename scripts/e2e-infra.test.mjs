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
  serverLogReadings,
  signInWords,
  slowReads,
  waitingWords,
} from './e2e-infra.mjs';
import { causeOf, startProbe } from './e2e-run.mjs';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

// [NFR-12-f][NFR-12-g] The preview's own server errors (WP-119, #183): a Supabase 502 to a page the
// preview renders on the server, which the browser sees only as the app's error page.
const appLine = (fields) =>
  JSON.stringify({
    level: 'error',
    msg: 'server error',
    time: '2026-11-04T16:08:12.764Z',
    requestId: 'iad1::abc',
    method: 'GET',
    route: '/admin/insights',
    kind: 'render',
    ...fields,
  });
const GATEWAY_PAGE =
  'household lookup: <html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<center>cloudflare</center></html>';

test('[NFR-12-f] a server error in the preview’s log naming the infrastructure is a bad reading at its own time; the app’s own errors are none', () => {
  // As the log record carries it: fields of its own, the app's JSON line in its message.
  const record = JSON.stringify({
    timestamp: Date.parse('2026-11-04T16:08:12.765Z'),
    requestPath: '/admin/insights',
    requestMethod: 'GET',
    level: 'error',
    message: appLine({ error: { name: 'Error', message: GATEWAY_PAGE } }),
  });
  // The same request's stack, a second line: one reading, not two.
  const stack = JSON.stringify({
    timestamp: Date.parse('2026-11-04T16:08:12.763Z'),
    requestPath: '/admin/insights',
    requestMethod: 'GET',
    requestId: 'iad1::abc',
    message: `Error: ${GATEWAY_PAGE}\n    at g (.next/server/chunks/ssr/x.js:1:11978)`,
  });
  const seen = new Set();
  const [one, ...more] = serverLogReadings(`${record}\n${stack}\nnot a record\n`, seen);
  assert.deepEqual(more, []);
  assert.equal(one.at, Date.parse('2026-11-04T16:08:12.765Z'));
  assert.equal(
    one.what,
    "the preview's server failed on GET /admin/insights: gateway 5xx (502 Bad Gateway), in its log",
  );
  // A later read that overlaps this one adds nothing again.
  assert.deepEqual(serverLogReadings(record, seen), []);
  // Only the app's line in the message: its own time, request and id.
  const [inner] = serverLogReadings(
    JSON.stringify({
      message: appLine({
        error: { message: 'insights: canceling statement due to statement timeout' },
      }),
    }),
  );
  assert.equal(inner.at, Date.parse('2026-11-04T16:08:12.764Z'));
  assert.match(inner.what, /GET \/admin\/insights: database statement timeout, in its log$/);
  // A timestamp in seconds.
  assert.equal(
    serverLogReadings(JSON.stringify({ timestamp: 1793808492, message: 'ECONNRESET' }))[0].at,
    1793808492000,
  );
  // The app's own error, a record without a time, or no record at all: no reading.
  assert.deepEqual(
    serverLogReadings(
      [
        JSON.stringify({
          timestamp: 1793808492000,
          message: appLine({ error: { message: 'TypeError: x is undefined' } }),
        }),
        JSON.stringify({ message: '502 Bad Gateway' }),
        '502 Bad Gateway',
        '',
      ].join('\n'),
    ),
    [],
  );
});

/** A stand-in `vercel` on the PATH that prints `out`, or fails with `err`, and records its arguments. */
function fakeVercel({ out = '', err = '', code = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'fake-vercel-'));
  const bin = join(dir, 'vercel');
  writeFileSync(join(dir, 'out.txt'), out);
  writeFileSync(join(dir, 'err.txt'), err);
  writeFileSync(
    bin,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/out.txt"\ncat "${dir}/err.txt" >&2\nexit ${code}\n`,
  );
  chmodSync(bin, 0o755);
  return dir;
}

async function probeWith(dir, token = 'tok-secret-123') {
  const env = { PATH: process.env.PATH, VERCEL_TOKEN: process.env.VERCEL_TOKEN };
  process.env.PATH = `${dir}:${env.PATH}`;
  process.env.VERCEL_TOKEN = token;
  // A base nothing answers on: the health probe's timers are stopped before they fire.
  const probe = startProbe({ db: undefined, base: 'http://127.0.0.1:9' });
  try {
    await probe.flush();
    return {
      degraded: [...probe.degraded],
      notes: probe.notes.map((n) => (typeof n === 'function' ? n() : n)),
    };
  } finally {
    probe.stop();
    process.env.PATH = env.PATH;
    if (env.VERCEL_TOKEN === undefined) delete process.env.VERCEL_TOKEN;
    else process.env.VERCEL_TOKEN = env.VERCEL_TOKEN;
  }
}

test('[NFR-12-g] the run reads the preview’s error log with the Vercel CLI, and a failed test while it named the infrastructure is infrastructure', async () => {
  const line = JSON.stringify({
    timestamp: Date.parse('2026-11-04T16:08:12.765Z'),
    requestPath: '/admin/insights',
    requestMethod: 'GET',
    message: appLine({ error: { message: GATEWAY_PAGE } }),
  });
  const dir = fakeVercel({ out: `${line}\n` });
  const { degraded, notes } = await probeWith(dir);
  assert.equal(degraded.length, 1);
  assert.match(degraded[0].what, /^the preview's server failed on GET \/admin\/insights/);
  // Its deployment, error level, as JSON, from a minute before the probe started.
  const args = (await import('node:fs')).readFileSync(join(dir, 'args.txt'), 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 2), ['logs', 'http://127.0.0.1:9']);
  for (const flag of ['--since', '--level', '--json', '--token'])
    assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--level') + 1], 'error');
  assert.match(notes.at(-1), /read 1 time\(s\), 1 error line\(s\).*1 naming the infrastructure/);
  // The test that failed around then is infrastructure; one a minute later is not.
  const at = Date.parse('2026-11-04T16:08:00Z');
  const verdict = classify(failure({ start: at, end: at + 44_000 }), degraded);
  assert.equal(
    classify(failure({ start: at + 60_000, end: at + 90_000 }), degraded).kind,
    'assertion',
  );
  assert.equal(verdict.kind, 'infra');
  assert.match(verdict.cause, /502 Bad Gateway/);
});

test('[NFR-12-g] a read of the preview’s log that fails is a note, without the token, and no reading', async () => {
  const dir = fakeVercel({ err: 'Error: The token tok-secret-123 is not valid', code: 1 });
  const { degraded, notes } = await probeWith(dir);
  assert.deepEqual(degraded, []);
  assert.match(notes.at(-1), /1 read\(s\) failed \(Error: The token \*\*\* is not valid\)/);
  assert.doesNotMatch(notes.at(-1), /tok-secret-123/);
});

test('[NFR-12-g] without a preview or a token there is no read, and the run says so', async () => {
  const probe = startProbe({ db: undefined, base: undefined });
  await probe.flush();
  probe.stop();
  assert.ok(
    probe.notes.includes(
      "no read of the preview's error log (E2E_BASE_URL or VERCEL_TOKEN not set)",
    ),
  );
});
