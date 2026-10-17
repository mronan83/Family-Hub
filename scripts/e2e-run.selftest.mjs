// [NFR-14][D-110] scripts/e2e-run.mjs against a real Playwright run (CI build job, where Chromium is
// installed): an injected statement timeout and an injected Supabase 5xx re-run once each and are
// labelled; a second infrastructure failure is red with its cause; an assertion failure is red and
// never re-runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'scripts/e2e-run-fixture');

function run(specs, env = {}) {
  const state = mkdtempSync(join(tmpdir(), 'e2e-selftest-'));
  const summary = join(state, 'summary.md');
  const reds = join(state, 'reds.json');
  const findings = join(state, 'findings.json');
  const r = spawnSync(
    'node',
    [
      'scripts/e2e-run.mjs',
      '--config',
      join(fixture, 'playwright.config.ts'),
      '--dir',
      fixture,
      '--specs',
      specs,
      '--summary',
      summary,
      '--reds',
      reds,
      '--findings',
      findings,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SUPABASE_DB_URL: '',
        E2E_BASE_URL: '',
        GITHUB_STEP_SUMMARY: '',
        CI: '',
        SELFTEST_STATE: state,
        ...env,
      },
    },
  );
  return {
    code: r.status,
    summary: readFileSync(summary, 'utf8'),
    reds: existsSync(reds) ? JSON.parse(readFileSync(reds, 'utf8')) : null,
    findings: existsSync(findings) ? JSON.parse(readFileSync(findings, 'utf8')) : null,
    out: r.stdout + r.stderr,
  };
}

test('[NFR-14][NFR-14-i] an injected statement timeout, a Supabase 5xx and Auth not answering re-run once, labelled, and pass', () => {
  const r = run('infra.spec.ts');
  assert.equal(r.code, 0, r.out);
  assert.match(r.summary, /## e2e: green/);
  assert.match(
    r.summary,
    /1 passed, 3 failed \(3 infrastructure, 0 assertion\), 3 passed on a re-run/,
  );
  assert.match(
    r.summary,
    /a statement timeout in the error \| infra \| database statement timeout \(in the error\) \| passed on its re-run/,
  );
  assert.match(
    r.summary,
    /infra \| the browser saw Supabase answer 500, a statement timeout to GET \/rest\/v1\/rpc\/board_snapshot \| passed on its re-run/,
  );
  assert.match(
    r.summary,
    /infra \| the preview’s demo sign-in found Supabase Auth not answering \(5xx or no answer\) \| passed on its re-run/,
  );
  assert.match(r.summary, /Re-runs \| 3 test\(s\), once each/);
  assert.deepEqual(r.reds, []);
  // Every re-run is logged in the findings log, though the run is green (WP-98, D-129).
  assert.equal(r.findings.length, 3);
  for (const e of r.findings) {
    assert.equal(e.kind, 'infra');
    assert.equal(e.red, false);
    assert.match(e.rerun, /^passed on its re-run/);
  }
});

test('[NFR-14][NFR-14-i] a second infrastructure failure is red, with its cause', () => {
  const r = run('infra.spec.ts', { SELFTEST_ALWAYS: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.summary, /## e2e: red/);
  assert.match(r.summary, /failed again: database statement timeout \(in the error\)/);
  // The issue for the spec names each red test's cause (.github/workflows/e2e.yml).
  assert.equal(r.reds.length, 1);
  assert.equal(r.reds[0].spec, 'infra.spec.ts');
  const timeout = r.reds[0].tests.find((t) => t.test.includes('a statement timeout in the error'));
  assert.equal(timeout.kind, 'infra');
  assert.equal(timeout.cause, 'database statement timeout (in the error)');
  const logged = r.findings.find((e) => e.test.includes('a statement timeout in the error'));
  assert.equal(logged.red, true);
  assert.equal(logged.rerun, 'failed again: database statement timeout (in the error)');
});

test('[NFR-14] an injected assertion failure is red and never re-runs', () => {
  const r = run('assertion.spec.ts');
  assert.equal(r.code, 1, r.out);
  assert.match(r.summary, /0 passed, 1 failed \(0 infrastructure, 1 assertion\)/);
  assert.match(r.summary, /an assertion failure \| assertion \| .*toHaveText.* \| red: not re-run/);
  assert.match(r.summary, /Re-runs \| none/);
  assert.equal(r.reds[0].spec, 'assertion.spec.ts');
  assert.equal(r.reds[0].tests[0].kind, 'assertion');
  assert.equal(r.reds[0].tests[0].then, 'red: not re-run');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].kind, 'assertion');
  assert.equal(r.findings[0].rerun, 'none (assertion failures never re-run)');
});
