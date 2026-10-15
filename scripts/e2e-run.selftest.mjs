// [NFR-14][D-104] scripts/e2e-run.mjs against a real Playwright run (CI build job, where Chromium is
// installed): an injected statement timeout and an injected Supabase 5xx re-run once each and are
// labelled; a second infrastructure failure is red with its cause; an assertion failure is red and
// never re-runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const fixture = join(root, 'scripts/e2e-run-fixture');

function run(specs, env = {}) {
  const state = mkdtempSync(join(tmpdir(), 'e2e-selftest-'));
  const summary = join(state, 'summary.md');
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
  return { code: r.status, summary: readFileSync(summary, 'utf8'), out: r.stdout + r.stderr };
}

test('[NFR-14] an injected statement timeout and a Supabase 5xx re-run once, labelled, and pass', () => {
  const r = run('infra.spec.ts');
  assert.equal(r.code, 0, r.out);
  assert.match(r.summary, /## e2e: green/);
  assert.match(
    r.summary,
    /1 passed, 2 failed \(2 infrastructure, 0 assertion\), 2 passed on a re-run/,
  );
  assert.match(
    r.summary,
    /a statement timeout in the error \| infra \| database statement timeout \(in the error\) \| passed on its re-run/,
  );
  assert.match(
    r.summary,
    /infra \| the browser saw Supabase answer 500, a statement timeout to GET \/rest\/v1\/rpc\/board_snapshot \| passed on its re-run/,
  );
  assert.match(r.summary, /Re-runs \| 2 test\(s\), once each/);
});

test('[NFR-14] a second infrastructure failure is red, with its cause', () => {
  const r = run('infra.spec.ts', { SELFTEST_ALWAYS: '1' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.summary, /## e2e: red/);
  assert.match(r.summary, /failed again: database statement timeout \(in the error\)/);
});

test('[NFR-14] an injected assertion failure is red and never re-runs', () => {
  const r = run('assertion.spec.ts');
  assert.equal(r.code, 1, r.out);
  assert.match(r.summary, /0 passed, 1 failed \(0 infrastructure, 1 assertion\)/);
  assert.match(r.summary, /an assertion failure \| assertion \| .*toHaveText.* \| red: not re-run/);
  assert.match(r.summary, /Re-runs \| none/);
});
