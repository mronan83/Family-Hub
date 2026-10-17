// [NFR-14][WP-98] A run of e2e by hand (scripts/e2e-guard.mjs and .github/workflows/e2e.yml).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { refusal } from './e2e-guard.mjs';

const workflow = readFileSync(join(import.meta.dirname, '../.github/workflows/e2e.yml'), 'utf8');
const job = (name) => {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  const next = workflow.slice(start + 1).search(/\n {2}[a-z-]+:\n/);
  return workflow.slice(start, next < 0 ? undefined : start + 1 + next);
};
const self = {
  databaseId: 9,
  status: 'in_progress',
  url: 'https://run/9',
  event: 'workflow_dispatch',
};

test('[NFR-14-n] a run by hand starts on main when no other e2e run is queued or going', () => {
  const done = { databaseId: 8, status: 'completed', url: 'https://run/8', event: 'schedule' };
  assert.equal(refusal({ ref: 'refs/heads/main', runs: [self, done], self: 9 }), null);
});

test('[NFR-14-n] a run by hand never displaces or joins behind another run, and starts on main only', () => {
  const nightly = { databaseId: 7, status: 'in_progress', url: 'https://run/7', event: 'schedule' };
  const waiting = { databaseId: 8, status: 'pending', url: 'https://run/8', event: 'schedule' };
  assert.match(
    refusal({ ref: 'refs/heads/main', runs: [self, nightly], self: '9' }),
    /Another e2e run is going \(https:\/\/run\/7\)/,
  );
  assert.match(
    refusal({ ref: 'refs/heads/main', runs: [self, waiting], self: 9 }),
    /is waiting \(https:\/\/run\/8\).*never cancels or displaces/,
  );
  assert.match(
    refusal({ ref: 'refs/heads/claude/wp-98', runs: [self], self: 9 }),
    /main only, not claude\/wp-98/,
  );
});

test('[NFR-14-n] e2e.yml can be run by hand, guarded, in the one demo-family group, and logs every run', () => {
  assert.match(
    workflow,
    /\non:\n {2}schedule:\n {4}- cron: '17 7 \* \* \*'\n {2}workflow_dispatch:\n/,
  );
  assert.doesNotMatch(workflow, /pull_request|workflow_run|push:/);
  const guard = job('guard');
  assert.match(
    guard,
    /if: github\.event_name == 'workflow_dispatch'\n\s+env:[\s\S]*REF: \$\{\{ github\.ref \}\}[\s\S]*run: node scripts\/e2e-guard\.mjs/,
  );
  assert.doesNotMatch(guard, /concurrency/);
  const nightly = job('nightly');
  assert.match(nightly, /needs: guard/);
  assert.match(nightly, /concurrency:\n\s+group: demo-family\n\s+cancel-in-progress: false/);
  assert.match(nightly, /ref: main/);
  assert.match(nightly, /e2e-run\.mjs .*--findings "\$RUNNER_TEMP\/e2e-findings\.json"/);
  assert.match(
    nightly,
    /- name: Findings log\n\s+if: always\(\) && steps\.checkout\.outcome == 'success'/,
  );
  assert.match(nightly, /issues: write/);
  // The group holds e2e alone: no other workflow can be cancelled by it.
  assert.equal((workflow.match(/group: demo-family/g) ?? []).length, 1);
});
