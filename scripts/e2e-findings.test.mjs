// [NFR-14][WP-98] The e2e findings log (scripts/e2e-findings.mjs), from a run's Playwright report to
// the comment on "E2E findings log" and the run summary, against a fake `gh` that records its calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { causeOf, failuresIn, resultsOf, settle } from './e2e-run.mjs';
import { LOG_TITLE, commentOf, counts, entriesOf, logged, summaryOf } from './e2e-findings.mjs';

const script = join(import.meta.dirname, 'e2e-findings.mjs');
const SECRET =
  'postgresql://postgres.puoctwssryisuzakhzxj:S3cretPw@aws-0.pooler.supabase.com:5432/postgres';

// One spec's result as Playwright's JSON report writes it.
const spec = (title, line, status, error) => ({
  title,
  file: 'chores.spec.ts',
  line,
  tests: [
    {
      annotations: [],
      results: [
        {
          status,
          duration: 4_000,
          startTime: '2026-10-18T07:30:00.000Z',
          errors: error ? [{ message: error }] : [],
          annotations: [],
        },
      ],
    },
  ],
});
const report = (...specs) => ({
  suites: [{ title: 'chores.spec.ts', file: 'chores.spec.ts', specs }],
});

/** The three failures of one run, settled against their re-runs, as e2e-run.mjs does. */
function oneRun() {
  const first = report(
    spec(
      '[CHR-04] a tick shows on the board',
      10,
      'failed',
      'expect(locator).toHaveText(expected) failed',
    ),
    spec(
      '[CHR-13] a save shows its banner',
      20,
      'failed',
      'ERROR: canceling statement due to statement timeout',
    ),
    spec('[CHR-05] undo puts it back', 30, 'timedOut', 'read ECONNRESET'),
    spec('[CHR-06] a skipped day', 40, 'passed'),
  );
  const again = report(
    spec('[CHR-13] a save shows its banner', 20, 'passed'),
    spec('[CHR-05] undo puts it back', 30, 'failed', 'socket hang up'),
  );
  const failures = failuresIn(resultsOf(first), []);
  const rerun = new Map(resultsOf(again).map((r) => [`${r.file}:${r.line}`, r]));
  settle(failures, rerun, []);
  return entriesOf({ failures: failures.map((f) => ({ ...f, cause: causeOf(f) })) });
}

test('[NFR-14-i] an assertion failure, a re-run that passed and one that failed twice make three entries', () => {
  const entries = oneRun();
  assert.equal(entries.length, 3);
  const [assertion, passed, twice] = entries;
  assert.deepEqual(
    {
      spec: assertion.spec,
      kind: assertion.kind,
      red: assertion.red,
      rerun: assertion.rerun,
      key: assertion.key,
    },
    {
      spec: 'chores.spec.ts',
      kind: 'assertion',
      red: true,
      rerun: 'none (assertion failures never re-run)',
      key: 'chores.spec.ts › [CHR-04] a tick shows on the board',
    },
  );
  assert.equal(assertion.cause, 'expect(locator).toHaveText(expected) failed');
  assert.equal(passed.kind, 'infra');
  assert.equal(passed.cause, 'database statement timeout (in the error)');
  assert.match(passed.rerun, /^passed on its re-run/);
  assert.equal(passed.red, false);
  assert.equal(twice.kind, 'infra');
  assert.equal(twice.cause, 'connection reset (in the error)');
  assert.equal(twice.rerun, 'failed again: connection reset (in the error)');
  assert.equal(twice.red, true);

  const body = commentOf({
    entries,
    tally: counts([], ['9'], entries, '9'),
    run: {
      id: '9',
      url: 'https://run/9',
      sha: 'abcdef1234',
      event: 'schedule',
      date: '2026-10-18',
      recent: 1,
    },
  });
  assert.match(body, /2 red, 1 of 2 infrastructure re-run\(s\) passed/);
  assert.match(body, /\| assertion \| expect\(locator\)\.toHaveText\(expected\) failed \| none/);
  assert.match(
    body,
    /\| infra \| database statement timeout \(in the error\) \| passed on its re-run .*\| none needed: passed on its re-run \|/,
  );
  assert.equal((body.match(/\| open \|/g) ?? []).length, 2);
  assert.deepEqual(logged([body]), [
    {
      run: '9',
      keys: entries.map(({ key, red }) => ({ key, red })),
    },
  ]);
});

test('[NFR-14-j] a test that failed in 2 of the last 30 runs is counted and listed; older runs are not', () => {
  const key = 'chores.spec.ts › [CHR-04] a tick shows on the board';
  const once = 'meal-edit.spec.ts › [MEAL-03] a meal edits';
  const recent = Array.from({ length: 30 }, (_, i) => String(100 + i)); // runs 100..129, 129 is this run
  const history = [
    { run: '90', keys: [{ key, red: true }] }, // outside the last 30
    { run: '105', keys: [{ key, red: true }] },
    { run: '110', keys: [{ key: once, red: true }] },
  ];
  const tally = counts(history, recent, [{ key, red: true }], '129');
  assert.deepEqual(tally.get(key), { failed: 2, red: 2 });
  assert.deepEqual(tally.get(once), { failed: 1, red: 1 });
  const text = summaryOf({ tally, recent: 30, logUrl: 'https://issue/1', wrote: true });
  assert.match(text, /Failed in more than one of the last 30 runs:/);
  assert.match(text, /- chores\.spec\.ts › \[CHR-04\] a tick shows on the board: 2 runs \(2 red\)/);
  assert.doesNotMatch(text, /MEAL-03/);

  const entries = [
    {
      spec: 'chores.spec.ts',
      test: 'chores.spec.ts:10 x',
      key,
      kind: 'assertion',
      cause: 'c',
      rerun: 'none',
      red: true,
    },
  ];
  const body = commentOf({
    entries,
    tally,
    run: { id: '129', url: 'u', sha: 'abcdef1', event: 'schedule', date: '2026-10-18', recent: 30 },
  });
  assert.match(body, /Failed in the last 30 runs/);
  assert.match(body, /\| 2 \(2 red\) \| open \|/);
});

// --- The script itself, against a fake gh -----------------------------------------------------

const fakeGh = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/gh.log"
case "$1 $2" in
  "run list") cat "$FAKE_DIR/runs.json" ;;
  "issue list") cat "$FAKE_DIR/issues.json" ;;
  "api --paginate") cat "$FAKE_DIR/comments.txt" 2>/dev/null ;;
  "issue create") echo "https://github.com/owner/repo/issues/77" ;;
  "issue comment") cat > "$FAKE_DIR/comment-$(date +%s%N).md" ;;
esac
exit 0
`;

function run({ entries, issues = [], comments = [], runs = ['500', '501'], runId = '501' }) {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-findings-'));
  writeFileSync(join(dir, 'gh'), fakeGh);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(
    join(dir, 'runs.json'),
    JSON.stringify(runs.map((databaseId) => ({ databaseId: Number(databaseId) }))),
  );
  writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues));
  if (comments.length)
    writeFileSync(join(dir, 'comments.txt'), comments.map((c) => JSON.stringify(c)).join('\n'));
  const findings = join(dir, 'findings.json');
  if (entries) writeFileSync(findings, JSON.stringify(entries));
  const summary = join(dir, 'summary.md');
  const r = spawnSync(
    'node',
    [script, '--findings', findings, '--reds', join(dir, 'none.json'), '--summary', summary],
    {
      encoding: 'utf8',
      env: {
        PATH: `${dir}:${process.env.PATH}`,
        FAKE_DIR: dir,
        REPO: 'owner/repo',
        RUN_ID: runId,
        RUN_URL: `https://github.com/owner/repo/actions/runs/${runId}`,
        SHA: 'c6365f036bc983e7',
        EVENT: 'workflow_dispatch',
      },
    },
  );
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const calls = readFileSync(join(dir, 'gh.log'), 'utf8').trim().split('\n');
  const written = spawnSync('bash', ['-c', `cat "${dir}"/comment-*.md 2>/dev/null`], {
    encoding: 'utf8',
  }).stdout;
  return {
    calls,
    written,
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
    stdout: r.stdout,
  };
}

const anEntry = (over = {}) => ({
  spec: 'chores.spec.ts',
  test: 'chores.spec.ts:10 [CHR-04] a tick shows on the board',
  key: 'chores.spec.ts › [CHR-04] a tick shows on the board',
  kind: 'assertion',
  cause: 'expect(locator).toHaveText(expected) failed',
  rerun: 'none (assertion failures never re-run)',
  red: true,
  ...over,
});

test('[NFR-14-k] a run with no failed test writes no entry and opens no issue, and still lists repeats', () => {
  const earlier = commentOf({
    entries: [anEntry()],
    tally: new Map(),
    run: { id: '498', url: 'u', sha: 'aaaaaaa', event: 'schedule', date: '2026-10-16', recent: 1 },
  });
  const later = earlier.replace('"run":"498"', '"run":"499"');
  const { calls, written, summary } = run({
    entries: [],
    issues: [{ number: 77, title: LOG_TITLE, url: 'https://github.com/owner/repo/issues/77' }],
    comments: [earlier, later],
    runs: ['498', '499', '500', '501'],
  });
  assert.equal(written, '');
  assert.ok(
    !calls.some((c) => c.startsWith('issue create') || c.startsWith('issue comment')),
    calls.join('\n'),
  );
  assert.match(summary, /A green run writes no entry/);
  assert.match(summary, /\[CHR-04\] a tick shows on the board: 2 runs \(2 red\)/);
});

test('[NFR-14-l] a connection string, password included, never reaches the findings log or the run summary', () => {
  // From the report: an error that quotes a failed psql command, as goal-steps did on 17 October.
  const first = report(
    spec(
      `[GOAL-09] clean-up ${SECRET}`,
      12,
      'failed',
      `Command failed: psql ${SECRET} -c "delete from item"`,
    ),
  );
  const entries = entriesOf({
    failures: failuresIn(resultsOf(first), []).map((f) => ({ ...f, cause: causeOf(f) })),
    runErrors: [{ test: 'the run', cause: `could not connect: ${SECRET}` }],
  });
  assert.ok(!JSON.stringify(entries).includes('S3cretPw'));
  // And the script redacts again whatever it is handed, before it writes anything.
  const { written, summary, stdout } = run({
    entries: [
      anEntry({
        test: `chores.spec.ts:10 ${SECRET}`,
        key: `chores.spec.ts › ${SECRET}`,
        cause: `psql ${SECRET} failed`,
      }),
      anEntry({ key: 'other', kind: 'infra', cause: 'x', rerun: `failed again: ${SECRET}` }),
    ],
    comments: [],
    runs: ['500', '501'],
  });
  for (const text of [written, summary, stdout]) {
    assert.ok(!text.includes('S3cretPw'), text);
    assert.ok(!text.includes('pooler.supabase.com'), text);
  }
  assert.match(written, /postgresql:\/\/\*\*\*/);
  assert.match(written, /failed again: postgresql:\/\/\*\*\*/);
});

test('[NFR-14-m] the first red run opens "E2E findings log"; later runs comment on it and read it back', () => {
  const firstRun = run({ entries: [anEntry()], issues: [], runs: ['500', '501'], runId: '501' });
  assert.ok(
    firstRun.calls.some((c) =>
      c.startsWith(`issue create --repo owner/repo --title ${LOG_TITLE} --body`),
    ),
  );
  assert.ok(
    firstRun.calls.some(
      (c) =>
        c ===
        'issue comment https://github.com/owner/repo/issues/77 --repo owner/repo --body-file -',
    ),
  );
  assert.match(firstRun.written, /run by hand on c6365f0/);
  assert.match(firstRun.written, /\| 1 \(1 red\) \| open \|/);

  const second = run({
    entries: [anEntry()],
    issues: [{ number: 77, title: LOG_TITLE, url: 'https://github.com/owner/repo/issues/77' }],
    comments: [firstRun.written],
    runs: ['500', '501', '502'],
    runId: '502',
  });
  assert.ok(!second.calls.some((c) => c.startsWith('issue create')), second.calls.join('\n'));
  assert.ok(
    second.calls.some((c) => c.startsWith('api --paginate repos/owner/repo/issues/77/comments')),
  );
  assert.match(second.written, /\| 2 \(2 red\) \| open \|/);
  assert.match(second.summary, /\[CHR-04\] a tick shows on the board: 2 runs \(2 red\)/);
});

test('[NFR-14-m] when GitHub cannot be reached, the summary says so and the run is not failed by it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-findings-'));
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env bash\necho "HTTP 502 from ${SECRET}" >&2\nexit 1\n`,
  );
  chmodSync(join(dir, 'gh'), 0o755);
  const summary = join(dir, 'summary.md');
  const r = spawnSync('node', [script, '--summary', summary], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'owner/repo',
      RUN_ID: '1',
      RUN_URL: 'u',
      SHA: 'abc',
    },
  });
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(summary, 'utf8');
  assert.match(text, /Not written: gh run list: HTTP 502/);
  assert.ok(!text.includes('S3cretPw'));
});
