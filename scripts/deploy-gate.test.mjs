// Deploy gate refusals (01 §9.6, D-36). Runs scripts/deploy-gate.sh against a fake `gh` that
// serves JSON fixtures through the real jq filters, and a fake `curl` for the Vercel token check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const gate = join(import.meta.dirname, 'deploy-gate.sh');
const REPO = 'owner/repo';
const SHA = 'a'.repeat(40);
const PR_HEAD = 'b'.repeat(40);

const fakeGh = `#!/usr/bin/env bash
# gh api PATH --jq EXPR: serve the fixture for PATH, filtered like gh does (raw strings).
echo "$2" >> "$FAKE_DIR/gh.log"
f="$FAKE_DIR/$(printf '%s' "$2" | tr '/?=' '___').json"
[ -f "$f" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
jq -r "$4" "$f"
`;
const fakeCurl = `#!/usr/bin/env bash
printf '%s' "$FAKE_VERCEL_STATUS"
`;

const checkRun = (conclusion) => ({ check_runs: conclusion ? [{ conclusion }] : [] });

function fixtures(over = {}) {
  return {
    [`repos/${REPO}/commits/main`]: { sha: SHA },
    ...Object.fromEntries(
      ['checks', 'database', 'docs', 'build'].map((c) => [
        `repos/${REPO}/commits/${SHA}/check-runs?check_name=${c}`,
        checkRun('success'),
      ]),
    ),
    [`repos/${REPO}/commits/${SHA}/pulls`]: [
      {
        number: 7,
        merged_at: '2026-10-08T20:00:00Z',
        base: { ref: 'main' },
        head: { sha: PR_HEAD },
      },
    ],
    [`repos/${REPO}/commits/${PR_HEAD}/check-runs?check_name=preview`]: checkRun('success'),
    ...over,
  };
}

function run({ env = {}, gh = fixtures(), vercel = '200' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-gate-'));
  writeFileSync(join(dir, 'gh'), fakeGh);
  writeFileSync(join(dir, 'curl'), fakeCurl);
  chmodSync(join(dir, 'gh'), 0o755);
  chmodSync(join(dir, 'curl'), 0o755);
  for (const [path, body] of Object.entries(gh)) {
    if (body !== undefined)
      writeFileSync(join(dir, `${path.replace(/[/?=]/g, '_')}.json`), JSON.stringify(body));
  }
  const output = join(dir, 'output');
  writeFileSync(output, '');
  const r = spawnSync('bash', [gate], {
    encoding: 'utf8',
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      FAKE_DIR: dir,
      FAKE_VERCEL_STATUS: vercel,
      GITHUB_OUTPUT: output,
      GITHUB_EVENT_NAME: 'workflow_run',
      GITHUB_REF: 'refs/heads/main',
      REPO,
      SHA,
      CI_CONCLUSION: 'success',
      HAS_SUPABASE_DB_URL: 'true',
      VERCEL_TOKEN: 'token',
      VERCEL_ORG_ID: 'team_x',
      VERCEL_PROJECT_ID: 'prj_x',
      PRODUCTION_URL: 'https://example.invalid',
      ...env,
    },
  });
  const log = join(dir, 'gh.log');
  return {
    code: r.status,
    out: r.stdout + r.stderr,
    deploy: /^deploy=(\w+)$/m.exec(readFileSync(output, 'utf8'))?.[1],
    ghCalls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
  };
}

const refused = (r, reason) => {
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, reason);
  assert.equal(r.deploy, undefined);
};

test('[NFR-14] ships the head of main from a merged PR with every check and e2e green', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  assert.equal(r.deploy, 'true');
  assert.match(r.out, /Deploying aaaaaaa from PR #7/);
});

test('[NFR-14] a manual run from main also ships', () => {
  const r = run({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch', CI_CONCLUSION: 'manual' } });
  assert.equal(r.deploy, 'true', r.out);
});

test('[NFR-14] refuses when configuration is missing, naming each item', () => {
  const r = run({ env: { HAS_SUPABASE_DB_URL: 'false', VERCEL_TOKEN: '', PRODUCTION_URL: '' } });
  refused(r, /missing configuration: SUPABASE_DB_URL VERCEL_TOKEN PRODUCTION_URL/);
  assert.deepEqual(r.ghCalls, []);
});

test('[NFR-14] refuses a Vercel token that cannot open the project, before anything else', () => {
  const r = run({ vercel: '403' });
  refused(r, /VERCEL_TOKEN cannot open the Vercel project \(HTTP 403\)/);
  assert.deepEqual(r.ghCalls, []);
});

test('[NFR-14] refuses a manual run from another branch', () => {
  const r = run({
    env: { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/feature' },
  });
  refused(r, /manual deploys run from main only/);
});

test('[NFR-14] skips a commit that is no longer the head of main', () => {
  const r = run({ gh: fixtures({ [`repos/${REPO}/commits/main`]: { sha: 'c'.repeat(40) } }) });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.deploy, 'false');
  assert.match(r.out, /main has moved on to ccccccc/);
});

test('[NFR-14] skips when its ci run was cancelled, refuses when ci failed', () => {
  const cancelled = run({ env: { CI_CONCLUSION: 'cancelled' } });
  assert.equal(cancelled.deploy, 'false', cancelled.out);
  refused(run({ env: { CI_CONCLUSION: 'failure' } }), /ci finished 'failure'/);
});

test('[NFR-14] refuses when any CI check failed or never ran', () => {
  const failed = `repos/${REPO}/commits/${SHA}/check-runs?check_name=database`;
  refused(run({ gh: fixtures({ [failed]: checkRun('failure') }) }), /ci \/ database is 'failure'/);
  const absent = `repos/${REPO}/commits/${SHA}/check-runs?check_name=build`;
  refused(run({ gh: fixtures({ [absent]: checkRun(null) }) }), /ci \/ build is 'missing'/);
});

test('[NFR-14] refuses a commit pushed to main without a merged pull request', () => {
  const pulls = `repos/${REPO}/commits/${SHA}/pulls`;
  refused(run({ gh: fixtures({ [pulls]: [] }) }), /reached main without a merged pull request/);
  const open = [{ number: 8, merged_at: null, base: { ref: 'main' }, head: { sha: PR_HEAD } }];
  refused(run({ gh: fixtures({ [pulls]: open }) }), /without a merged pull request/);
  const elsewhere = [
    {
      number: 9,
      merged_at: '2026-10-08T20:00:00Z',
      base: { ref: 'other' },
      head: { sha: PR_HEAD },
    },
  ];
  refused(run({ gh: fixtures({ [pulls]: elsewhere }) }), /without a merged pull request/);
});

test('[NFR-14] refuses when e2e did not pass on the pull request preview', () => {
  const preview = `repos/${REPO}/commits/${PR_HEAD}/check-runs?check_name=preview`;
  refused(
    run({ gh: fixtures({ [preview]: checkRun('failure') }) }),
    /e2e \/ preview on PR #7 is 'failure'/,
  );
  refused(
    run({ gh: fixtures({ [preview]: checkRun(null) }) }),
    /e2e \/ preview on PR #7 is 'missing'/,
  );
});

test('[NFR-14] refuses when GitHub cannot be read', () => {
  const r = run({ gh: fixtures({ [`repos/${REPO}/commits/main`]: undefined }) });
  assert.notEqual(r.code, 0, r.out);
  assert.equal(r.deploy, undefined);
});
