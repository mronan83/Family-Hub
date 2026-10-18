#!/usr/bin/env node
// [NFR-14][D-110] Runs e2e against a preview and decides the result (01 §9.5):
//
// 1. Runs the chosen specs once (all of them when none is named), then each burnt-in spec five times
//    in a row (--repeat-each=5): a burnt-in spec must pass all five.
// 2. While they run, probes the test database every 5 s and the preview's /api/health every 15 s,
//    and keeps each reading that was slow or failed.
// 3. Classifies each failed test (scripts/e2e-infra.mjs). An infrastructure failure (a statement
//    timeout, a refused or reset connection, a 5xx from Supabase or the preview's gateway, or the
//    database or preview slow or down while it ran) re-runs once, that test only (its whole file when
//    the file is serial); its spec makes its own household afresh as it starts (D-137), so nothing is
//    loaded again first. An assertion failure never re-runs.
// 4. Writes what ran, each failure with its cause, re-runs, timings and any test with less than 3×
//    headroom under its time limit to the run summary. Exits 1 unless every test passed, first time
//    or on its one infrastructure re-run.
//
//   node scripts/e2e-run.mjs [--specs "a.spec.ts b.spec.ts"] [--burn-in "a.spec.ts"] [--summary FILE]
//                            [--reds FILE] [--findings FILE]
//
// --reds writes each spec that ended red, with each red test's kind (infra or assertion) and cause,
// as JSON ([{ spec, tests: [{ test, kind, cause, then }] }]): the nightly run opens or updates one
// "E2E red on main: <spec>" issue from each (.github/workflows/e2e.yml). A run error or a pass that
// wrote no report is listed as the spec "set-up". --findings writes every failed test, those that
// passed on their re-run included, as the findings log's entries (scripts/e2e-findings.mjs, WP-98).
//
// Reads SUPABASE_DB_URL and E2E_BASE_URL (both optional: no probe without them),
// VERCEL_AUTOMATION_BYPASS_SECRET and GITHUB_STEP_SUMMARY.
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classify,
  errorText,
  failureOf,
  healthReading,
  redact,
  signInWords,
} from './e2e-infra.mjs';
import { entriesOf } from './e2e-findings.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BURN_IN = 5;

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? (process.argv[i + 1] ?? '') : undefined;
};
// Another config and its spec folder, for this script's own test (scripts/e2e-run.selftest.mjs).
const CONFIG = arg('--config') ?? 'e2e';
const SPECS = arg('--dir') ?? join(ROOT, 'e2e/tests');
const words = (s) => (s ?? '').split(/\s+/).filter(Boolean);

/** Readings of the test database and the preview that were slow or failed: [{ at, what }]. */
export function startProbe({
  db = process.env.SUPABASE_DB_URL,
  base = process.env.E2E_BASE_URL,
} = {}) {
  const degraded = [];
  const notes = [];
  const bad = (what) => degraded.push({ at: Date.now(), what });
  const timers = [];
  let psql;
  let pending = null;

  const open = () => {
    psql = spawn('psql', [db, '-X', '-A', '-t', '-q'], { stdio: ['pipe', 'pipe', 'pipe'] });
    psql.stdin.write("set statement_timeout = '10s';\n");
    let out = '';
    psql.stdout.on('data', (d) => {
      out += d;
      let nl;
      while ((nl = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, nl).trim();
        out = out.slice(nl + 1);
        if (line.startsWith('probe') && pending !== null) {
          const ms = Date.now() - pending;
          pending = null;
          if (ms > 2_000) bad(`the test database took ${ms} ms to answer a probe`);
        }
      }
    });
    psql.stderr.on('data', (d) => {
      const text = String(d).trim().split('\n')[0];
      if (text) bad(`the test database: ${text}`);
      pending = null;
    });
    psql.on('exit', () => {
      psql = null;
      pending = null;
    });
    psql.stdin.on('error', () => {});
  };

  if (db) {
    open();
    timers.push(
      setInterval(() => {
        if (pending !== null) {
          bad('the test database did not answer a probe within 5 s');
          pending = null;
        }
        if (!psql) {
          bad('the probe lost its connection to the test database');
          open();
        }
        pending = Date.now();
        psql.stdin.write("select 'probe ' || count(*) from pg_class;\n");
      }, 5_000),
    );
  } else notes.push('no test database probe (SUPABASE_DB_URL not set)');

  if (base) {
    const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
      : {};
    timers.push(
      setInterval(async () => {
        try {
          const at = Date.now();
          const r = await fetch(new URL('/api/health', base), {
            headers,
            signal: AbortSignal.timeout(10_000),
          });
          await r.arrayBuffer();
          const reading = healthReading(r.status, Date.now() - at);
          if (reading) bad(reading);
        } catch (e) {
          bad(
            `the preview did not answer /api/health (${e.name === 'TimeoutError' ? 'in 10 s' : e.message})`,
          );
        }
      }, 15_000),
    );
  } else notes.push('no preview probe (E2E_BASE_URL not set)');

  return {
    degraded,
    notes,
    stop() {
      for (const t of timers) clearInterval(t);
      psql?.stdin.end();
      psql?.kill();
    },
  };
}

/** Runs Playwright; resolves with its JSON report (or null if it wrote none). */
function playwright(args, label, dir) {
  const json = join(dir, `${label}.json`);
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('pnpm', ['exec', 'playwright', 'test', '-c', CONFIG, ...args], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, E2E_JSON: json },
    });
    child.on('exit', (code) => {
      const report = existsSync(json) ? JSON.parse(readFileSync(json, 'utf8')) : null;
      resolve({ label, code, report, ms: Date.now() - started });
    });
  });
}

/** Every test result in a report: [{ file, line, title, test, result }]. */
export function resultsOf(report) {
  const out = [];
  const visit = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          out.push({
            file: spec.file,
            line: spec.line,
            title: [...path, spec.title].filter(Boolean).join(' › '),
            test,
            result,
          });
        }
        if (!test.results?.length) {
          out.push({
            file: spec.file,
            line: spec.line,
            title: [...path, spec.title].join(' › '),
            test,
            result: null,
          });
        }
      }
    }
    for (const s of suite.suites ?? []) visit(s, s.file === s.title ? path : [...path, s.title]);
  };
  for (const s of report?.suites ?? []) visit(s, []);
  return out;
}

const failed = (r) => r.result && ['failed', 'timedOut', 'interrupted'].includes(r.result.status);
const notRun = (r) =>
  !r.result || (r.result.status === 'skipped' && r.test.expectedStatus !== 'skipped');
const serial = (file) => /mode:\s*'serial'/.test(readFileSync(join(SPECS, file), 'utf8'));
const limitOf = (r) => {
  const a = [...(r.result?.annotations ?? []), ...(r.test.annotations ?? [])].find(
    (x) => x.type === 'limit',
  );
  return a ? Number(a.description) : null;
};
const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const mins = (ms) =>
  `${Math.floor(ms / 60_000)}:${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}`;

/** Each failed test in a pass's results, classified: [{ ...result, verdict }]. */
export function failuresIn(results, degraded) {
  return results
    .filter(failed)
    .map((r) => ({ ...r, verdict: classify(failureOf(r.result, r.test), degraded) }));
}

/**
 * Settles each failure against its one re-run (rerun: Map "file:line" -> result): sets `after` on
 * each infrastructure failure, and returns the ones that ended red. An assertion failure is red.
 */
export function settle(failures, rerun, degraded) {
  const reds = [];
  for (const f of failures) {
    if (f.verdict.kind === 'assertion') {
      reds.push(f);
      continue;
    }
    const second = rerun.get(`${f.file}:${f.line}`);
    if (!second || failed(second) || notRun(second)) {
      const why =
        second && failed(second) ? classify(failureOf(second.result, second.test), degraded) : null;
      f.after =
        !second || notRun(second)
          ? 'did not run again'
          : `failed again: ${why.kind === 'infra' ? why.cause : 'assertion failure'}`;
      reds.push(f);
    } else f.after = `passed on its re-run (${secs(second.result.duration)})`;
  }
  return reds;
}

/** A failure's cause in words: the infrastructure it names, or the assertion's first line. */
export const causeOf = (f) =>
  f.verdict.kind === 'infra'
    ? f.verdict.cause
    : errorText(f.result.errors?.[0] ?? f.result.error)
        .split('\n')[0]
        .slice(0, 160);

async function main() {
  const specs = words(arg('--specs'));
  const burnIn = words(arg('--burn-in'));
  const dir = mkdtempSync(join(tmpdir(), 'e2e-run-'));
  const started = Date.now();
  const probe = startProbe();
  const lines = [];
  const say = (s = '') => lines.push(s);

  // 1. The chosen specs once, then the burnt-in ones five times each.
  const all = readdirSync(SPECS).filter((f) => f.endsWith('.spec.ts'));
  const once = (specs.length ? specs : all).filter((s) => !burnIn.includes(s));
  const passes = [];
  if (once.length)
    passes.push(await playwright(specs.length || burnIn.length ? once : [], 'run', dir));
  if (burnIn.length) {
    passes.push(await playwright([...burnIn, `--repeat-each=${BURN_IN}`], 'burn-in', dir));
  }

  const results = passes.flatMap((p) => resultsOf(p.report).map((r) => ({ ...r, pass: p.label })));
  const failures = failuresIn(results, probe.degraded);
  const globalErrors = passes.flatMap((p) =>
    (p.report?.errors ?? []).map((e) => redact(e.message ?? String(e))),
  );
  const missingReport = passes.filter((p) => !p.report);

  // 2. Infrastructure failures re-run once: that test, or its whole file when the file is serial.
  const infra = failures.filter((f) => f.verdict.kind === 'infra');
  const rerun = new Map();
  if (infra.length) {
    const units = [...new Set(infra.map((f) => (serial(f.file) ? f.file : `${f.file}:${f.line}`)))];
    const again = await playwright(units, 'rerun', dir);
    for (const r of resultsOf(again.report)) {
      const key = `${r.file}:${r.line}`;
      const prev = rerun.get(key);
      if (!prev || failed(r)) rerun.set(key, r);
    }
    if (!again.report) missingReport.push(again);
  }
  probe.stop();

  // 3. The verdict.
  const reds = settle(failures, rerun, probe.degraded);
  const rerunFiles = new Set(infra.filter((f) => serial(f.file)).map((f) => f.file));
  const skipped = results.filter(notRun).filter((r) => !rerunFiles.has(r.file) || !rerun.size);
  const passed = results.filter((r) => r.result?.status === 'passed').length;
  const green = !reds.length && !globalErrors.length && !missingReport.length && !skipped.length;

  say(`## e2e: ${green ? 'green' : 'red'}`);
  say();
  say('| | |');
  say('|---|---|');
  say(
    `| Specs | ${specs.length ? `${specs.length} of ${all.length} (named)` : `all ${all.length}`} |`,
  );
  if (burnIn.length) say(`| Burn-in | ${burnIn.join(', ')}, ${BURN_IN} runs each |`);
  say(
    `| Tests | ${passed} passed, ${failures.length} failed (${infra.length} infrastructure, ${failures.length - infra.length} assertion), ${failures.filter((f) => f.after?.startsWith('passed')).length} passed on a re-run, ${skipped.length} did not run |`,
  );
  say(`| Re-runs | ${infra.length ? `${rerun.size} test(s), once each` : 'none'} |`);
  say(`| Time | ${mins(Date.now() - started)} |`);
  // [NFR-14-z][D-137] Each spec signs in to its own household, so the run's sign-ins are counted.
  const signIns = signInWords(
    [...results, ...rerun.values()].flatMap((r) => [
      ...(r.result?.annotations ?? []),
      ...(r.test.annotations ?? []),
    ]),
  );
  say(`| Sign-ins | ${signIns ?? 'none'} |`);
  say(
    `| Probe | ${probe.degraded.length ? `${probe.degraded.length} slow or failed reading(s)` : 'the test database and the preview answered every probe in time'} |`,
  );
  if (failures.length) {
    say();
    say('### Failures');
    say();
    say('| Test | Kind | Cause | Then |');
    say('|---|---|---|---|');
    for (const f of failures) {
      const first = errorText(f.result.errors?.[0] ?? f.result.error)
        .split('\n')[0]
        .replace(/\|/g, '\\|');
      say(
        `| ${f.file}:${f.line} ${f.title.replace(/\|/g, '\\|')} | ${f.verdict.kind} | ${f.verdict.kind === 'infra' ? f.verdict.cause : first.slice(0, 160)} | ${f.after ?? 'red: not re-run'} |`,
      );
    }
  }
  for (const e of globalErrors) say(`\nRun error: ${e.split('\n')[0]}`);
  for (const p of missingReport) say(`\nThe ${p.label} pass wrote no report (exit ${p.code}).`);
  if (skipped.length) {
    say();
    say(`### Did not run (${skipped.length})`);
    for (const r of skipped.slice(0, 20)) say(`- ${r.file}:${r.line} ${r.title}`);
  }
  if (probe.degraded.length) {
    say();
    say('### Probe readings that were slow or failed');
    for (const d of probe.degraded.slice(0, 20))
      say(`- ${new Date(d.at).toISOString().slice(11, 19)} UTC: ${d.what}`);
  }
  const timed = results.filter((r) => r.result && r.result.status === 'passed');
  const tight = timed.filter((r) => limitOf(r) && r.result.duration * 3 > limitOf(r));
  if (tight.length) {
    say();
    say('### Under 3× headroom (time taken × 3 is over the test’s limit)');
    for (const r of tight)
      say(`- ${r.file}:${r.line} ${r.title}: ${secs(r.result.duration)} of ${secs(limitOf(r))}`);
  }
  say();
  say('<details><summary>Slowest tests</summary>');
  say();
  for (const r of [...timed].sort((a, b) => b.result.duration - a.result.duration).slice(0, 15)) {
    say(
      `- ${secs(r.result.duration)}${limitOf(r) ? ` of ${secs(limitOf(r))}` : ''}: ${r.file}:${r.line} ${r.title}`,
    );
  }
  say();
  say('</details>');
  for (const n of probe.notes) say(`\n_${n}_`);

  const text = `${lines.join('\n')}\n`;
  process.stdout.write(`\n${text}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  const file = arg('--summary');
  if (file) writeFileSync(file, text);
  const redsFile = arg('--reds');
  if (redsFile) {
    const bySpec = new Map();
    const add = (spec, entry) => bySpec.set(spec, [...(bySpec.get(spec) ?? []), entry]);
    for (const f of reds) {
      add(f.file, {
        test: `${f.file}:${f.line} ${f.title}`,
        kind: f.verdict.kind,
        cause: causeOf(f),
        then: f.after ?? 'red: not re-run',
      });
    }
    for (const r of skipped) {
      add(r.file, {
        test: `${r.file}:${r.line} ${r.title}`,
        kind: 'not run',
        cause: 'did not run',
        then: '',
      });
    }
    for (const e of globalErrors) {
      add('set-up', { test: 'the run', kind: 'run error', cause: e.split('\n')[0], then: '' });
    }
    for (const p of missingReport) {
      add('set-up', {
        test: `the ${p.label} pass`,
        kind: 'run error',
        cause: `wrote no report (exit ${p.code})`,
        then: '',
      });
    }
    writeFileSync(redsFile, JSON.stringify([...bySpec].map(([spec, tests]) => ({ spec, tests }))));
  }
  const findingsFile = arg('--findings');
  if (findingsFile) {
    const entries = entriesOf({
      failures: failures.map((f) => ({ ...f, cause: causeOf(f) })),
      notRun: skipped,
      runErrors: [
        ...globalErrors.map((e) => ({ test: 'the run', cause: e.split('\n')[0] })),
        ...missingReport.map((p) => ({
          test: `the ${p.label} pass`,
          cause: `wrote no report (exit ${p.code})`,
        })),
      ],
    });
    writeFileSync(findingsFile, JSON.stringify(entries));
  }
  process.exit(green ? 0 : 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
