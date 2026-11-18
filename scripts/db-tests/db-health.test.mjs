// [NFR-12][WP-124] scripts/db-health.sh on native Postgres (CI database job; no Docker): its checks
// are in scripts/db-health.test.sh, which makes a throwaway database with the migrations, the demo
// family and a board, runs the report and reads what it printed. Uses the libpq variables like
// scripts/db-test.sh.
//
//   node --test scripts/db-tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

test('[NFR-12-h] db-health reads a database read only: every section, the board timed as the board, nothing named, nothing changed', () => {
  const run = spawnSync('bash', [join(ROOT, 'scripts/db-health.test.sh')], { encoding: 'utf8' });
  // On a failure, the shell test's own lines say which check and what the report printed.
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /db-health: all passed/);
  assert.doesNotMatch(run.stdout, /^not ok/m);
});
