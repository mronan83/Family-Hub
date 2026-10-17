#!/usr/bin/env node
// [NFR-14][D-121][D-130] The e2e findings log (01 §9.5): one entry per test that failed in a nightly
// run, kept as one comment per run on the GitHub issue "E2E findings log". An entry says the date,
// the run, main's commit, the spec and test, its kind (assertion or infrastructure), its cause as
// scripts/e2e-run.mjs labelled it, its one infrastructure re-run (passed, failed again, or none for
// an assertion failure) and what was done ("open" until the worker who fixes it writes the PR in).
// A failure that passed on its re-run is logged too, so every re-run is counted (D-129). Each entry
// says in how many of the last 30 e2e runs the same test failed, and the run summary lists every
// test that failed in more than one of them. A green run writes no entry. Every word written goes
// through redact(): GitHub masks a secret in a job's log, not in an issue the job writes (D-48).
//
//   node scripts/e2e-findings.mjs [--findings FILE] [--reds FILE] [--summary FILE]
//
// --findings is e2e-run.mjs's own list; without it (the run ended before e2e finished) the entries
// come from --reds, the "E2E red on main" list the workflow wrote for the set-up. Reads REPO, RUN_ID,
// RUN_URL, SHA, EVENT and GITHUB_STEP_SUMMARY; calls `gh` (GH_TOKEN). It never fails the run: if
// GitHub can't be read or written, the summary says so.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { redact } from './e2e-infra.mjs';

export const LOG_TITLE = 'E2E findings log';
export const WINDOW = 30;
const MARK = 'e2e-findings';

/**
 * Entries from e2e-run.mjs's failures (each with file, line, title, verdict and after), the tests
 * that did not run, and the run's own errors: [{ spec, test, key, kind, cause, rerun, red }].
 * `key` names the test without its line, so a test keeps its count when lines above it move.
 */
export function entriesOf({ failures = [], notRun = [], runErrors = [] }) {
  const out = [];
  for (const f of failures) {
    const passed = f.after?.startsWith('passed') ?? false;
    out.push({
      spec: f.file,
      test: `${f.file}:${f.line} ${f.title}`,
      key: `${f.file} › ${f.title}`,
      kind: f.verdict.kind,
      cause: f.cause ?? f.verdict.cause,
      rerun: f.verdict.kind === 'assertion' ? 'none (assertion failures never re-run)' : f.after,
      red: !passed,
    });
  }
  for (const r of notRun) {
    out.push({
      spec: r.file,
      test: `${r.file}:${r.line} ${r.title}`,
      key: `${r.file} › ${r.title}`,
      kind: 'not run',
      cause: 'did not run',
      rerun: 'none',
      red: true,
    });
  }
  for (const e of runErrors) {
    out.push({
      spec: 'set-up',
      test: e.test,
      key: `set-up › ${e.test}`,
      kind: 'run error',
      cause: e.cause,
      rerun: 'none',
      red: true,
    });
  }
  return out.map(clean);
}

/** Entries from the "E2E red on main" list ([{ spec, tests: [{ test, kind, cause, then }] }]). */
export function entriesOfReds(reds) {
  return reds
    .flatMap(({ spec, tests }) =>
      tests.map((t) => ({
        spec,
        test: t.test,
        key: `${spec} › ${t.test.replace(/^\S+:\d+ /, '')}`,
        kind: t.kind,
        cause: t.cause,
        rerun: t.then || 'none',
        red: true,
      })),
    )
    .map(clean);
}

const clean = (e) =>
  Object.fromEntries(Object.entries(e).map(([k, v]) => [k, typeof v === 'string' ? redact(v) : v]));

/** What earlier runs logged, from the issue's comments: [{ run, keys: [{ key, red }] }]. */
export function logged(bodies) {
  const out = [];
  const re = new RegExp(`<!-- ${MARK} (\\{.*?\\}) -->`);
  for (const body of bodies) {
    const m = re.exec(body ?? '');
    if (!m) continue;
    try {
      const { run, keys } = JSON.parse(m[1]);
      if (run && Array.isArray(keys)) out.push({ run: String(run), keys });
    } catch {
      // A comment someone edited out of shape is skipped, not fatal.
    }
  }
  return out;
}

/**
 * How many of the recent runs each test failed in, and in how many it ended red.
 *   history: logged(); recent: the last WINDOW e2e runs' ids, this one included; now: this run's
 *   entries. Returns Map key -> { failed, red }.
 */
export function counts(history, recent, now, runId) {
  const ids = new Set(recent.map(String));
  const byRun = new Map(history.filter((h) => ids.has(h.run)).map((h) => [h.run, h.keys]));
  byRun.set(
    String(runId),
    now.map(({ key, red }) => ({ key, red })),
  );
  const out = new Map();
  for (const keys of byRun.values()) {
    const seen = new Map();
    for (const { key, red } of keys) seen.set(key, (seen.get(key) ?? false) || red);
    for (const [key, red] of seen) {
      const c = out.get(key) ?? { failed: 0, red: 0 };
      c.failed += 1;
      if (red) c.red += 1;
      out.set(key, c);
    }
  }
  return out;
}

const cell = (s) =>
  String(s ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');

/** The comment one red run writes: a table of its entries, and a marker the next runs read. */
export function commentOf({ entries, tally, run }) {
  const window = Math.min(WINDOW, run.recent ?? WINDOW);
  const reruns = entries.filter((e) => e.kind === 'infra');
  const lines = [
    `### ${run.date}: ${run.event === 'workflow_dispatch' ? 'run by hand' : 'nightly run'} on ${run.sha.slice(0, 7)}`,
    '',
    `${entries.filter((e) => e.red).length} red, ${reruns.filter((e) => !e.red).length} of ${reruns.length} infrastructure re-run(s) passed. [The run](${run.url}).`,
    '',
    `| Spec | Test | Kind | Cause | Re-run | Failed in the last ${window} runs | Done |`,
    '|---|---|---|---|---|---|---|',
    ...entries.map((e) => {
      const c = tally.get(e.key) ?? { failed: 1, red: e.red ? 1 : 0 };
      return `| ${cell(e.spec)} | ${cell(e.test)} | ${cell(e.kind)} | ${cell(e.cause)} | ${cell(e.rerun)} | ${c.failed} (${c.red} red) | ${e.red ? 'open' : 'none needed: passed on its re-run'} |`;
    }),
    '',
    '_The worker who fixes a red test writes its PR in **Done**._',
    '',
    `<!-- ${MARK} ${JSON.stringify({ run: String(run.id), keys: entries.map(({ key, red }) => ({ key, red })) }).replace(/--/g, '\\u002d\\u002d')} -->`,
  ];
  return redact(lines.join('\n'));
}

/** The run summary's part: every test that failed in more than one of the recent runs. */
export function summaryOf({ tally, recent, logUrl, wrote }) {
  const window = Math.min(WINDOW, recent);
  const repeats = [...tally]
    .filter(([, c]) => c.failed > 1)
    .sort((a, b) => b[1].failed - a[1].failed || a[0].localeCompare(b[0]));
  const lines = ['### Findings log', ''];
  lines.push(
    wrote
      ? `This run's entries are in [${LOG_TITLE}](${logUrl}).`
      : logUrl
        ? `A green run writes no entry. [${LOG_TITLE}](${logUrl}).`
        : 'A green run writes no entry.',
  );
  lines.push('');
  if (repeats.length) {
    lines.push(`Failed in more than one of the last ${window} runs:`, '');
    for (const [key, c] of repeats)
      lines.push(`- ${key.replace(/\r?\n/g, ' ')}: ${c.failed} runs (${c.red} red)`);
  } else lines.push(`No test failed in more than one of the last ${window} runs.`);
  return redact(`${lines.join('\n')}\n`);
}

const gh = (args, input) => {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: ${r.stderr.trim()}`);
  return r.stdout;
};

function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const { REPO, RUN_ID, RUN_URL, SHA = '', EVENT = 'schedule' } = process.env;
  const read = (f) => (f && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
  const findings = read(arg('--findings'));
  const entries = findings ?? entriesOfReds(read(arg('--reds')) ?? []);
  let text;
  try {
    const recent = JSON.parse(
      gh([
        'run',
        'list',
        '--repo',
        REPO,
        '--workflow',
        'e2e.yml',
        '--branch',
        'main',
        '--limit',
        String(WINDOW),
        '--json',
        'databaseId',
      ]),
    ).map((r) => String(r.databaseId));
    if (!recent.includes(String(RUN_ID))) recent.splice(WINDOW - 1, Infinity, String(RUN_ID));
    const open = JSON.parse(
      gh([
        'issue',
        'list',
        '--repo',
        REPO,
        '--state',
        'open',
        '--limit',
        '500',
        '--json',
        'number,title,url',
      ]),
    ).find((i) => i.title === LOG_TITLE);
    const bodies = open
      ? gh([
          'api',
          '--paginate',
          `repos/${REPO}/issues/${open.number}/comments`,
          '--jq',
          '.[].body | @json',
        ])
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
    const tally = counts(logged(bodies), recent, entries, RUN_ID);
    let logUrl = open?.url;
    if (entries.length) {
      if (!open) {
        logUrl = gh([
          'issue',
          'create',
          '--repo',
          REPO,
          '--title',
          LOG_TITLE,
          '--body',
          'One comment per e2e run with a failed test (WP-98, D-130): each test that failed, its kind and cause, its one infrastructure re-run, how many of the last 30 runs it failed in, and what was done. Written by `.github/workflows/e2e.yml`; never closed.',
        ]).trim();
      }
      const body = commentOf({
        entries,
        tally,
        run: {
          id: RUN_ID,
          url: RUN_URL,
          sha: SHA,
          event: EVENT,
          date: new Date().toISOString().slice(0, 10),
          recent: recent.length,
        },
      });
      gh(['issue', 'comment', logUrl, '--repo', REPO, '--body-file', '-'], body);
    }
    text = summaryOf({ tally, recent: recent.length, logUrl, wrote: entries.length > 0 });
  } catch (e) {
    process.stdout.write(`::warning::The findings log could not be read or written\n`);
    text = redact(`### Findings log\n\nNot written: ${String(e.message).split('\n')[0]}\n`);
  }
  process.stdout.write(`\n${text}`);
  const summary = arg('--summary') ?? process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `\n${text}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
