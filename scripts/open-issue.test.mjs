// One issue per title (D-108): scripts/open-issue.sh against a fake `gh` that records its calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, 'open-issue.sh');

const fakeGh = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/gh.log"
[ "$1 $2" = "issue list" ] && cat "$FAKE_DIR/issues.json"
exit 0
`;

function run(issues, title = 'E2E red on main: chores.spec.ts') {
  const dir = mkdtempSync(join(tmpdir(), 'open-issue-'));
  writeFileSync(join(dir, 'gh'), fakeGh);
  chmodSync(join(dir, 'gh'), 0o755);
  writeFileSync(join(dir, 'issues.json'), JSON.stringify(issues));
  const r = spawnSync('bash', [script, title, 'what failed'], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, FAKE_DIR: dir, REPO: 'owner/repo' },
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return readFileSync(join(dir, 'gh.log'), 'utf8').trim().split('\n').slice(1);
}

test('[NFR-14] opens an issue when none with the title is open', () => {
  const calls = run([{ number: 3, title: 'E2E red on main: chores.spec.ts (old)' }]);
  assert.equal(calls.length, 1);
  assert.match(
    calls[0],
    /^issue create --repo owner\/repo --title E2E red on main: chores.spec.ts/,
  );
});

test('[NFR-14] comments on the open issue with the same title, and opens no second one', () => {
  const calls = run([
    { number: 3, title: 'Deploy refused: abc1234' },
    { number: 9, title: 'E2E red on main: chores.spec.ts' },
  ]);
  assert.deepEqual(calls, ['issue comment 9 --repo owner/repo --body what failed']);
});
