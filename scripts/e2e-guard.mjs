#!/usr/bin/env node
// [NFR-14][D-108][D-121][D-130] A run of e2e started by hand (Actions → e2e → Run workflow) starts
// only on main, and only when no other e2e run is queued or going. The e2e job's concurrency group
// (`demo-family`) holds one run and keeps one waiting, and GitHub cancels a waiting run when a newer
// one joins: so a run by hand that joined the group could cancel the night's run, or one started
// before it. This refuses it first, with the run to wait for. The scheduled run never asks.
//
// Reads REPO, RUN_ID and REF; calls `gh` (GH_TOKEN). Exits 1 with the reason when it refuses.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Why a run by hand may not start, or null. runs: [{ databaseId, status, url, event }]. */
export function refusal({ ref, runs, self }) {
  if (ref !== 'refs/heads/main')
    return `A run by hand starts on main only, not ${ref.replace(/^refs\/heads\//, '')}: choose main under "Use workflow from".`;
  const going = runs.filter(
    (r) => String(r.databaseId) !== String(self) && r.status !== 'completed',
  );
  if (going.length)
    return `Another e2e run is ${going[0].status === 'in_progress' ? 'going' : 'waiting'} (${going[0].url}). Start this one again once it has finished: e2e never cancels or displaces a run.`;
  return null;
}

function main() {
  const { REPO, RUN_ID, REF } = process.env;
  const r = spawnSync(
    'gh',
    [
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'e2e.yml',
      '--limit',
      '20',
      '--json',
      'databaseId,status,url,event',
    ],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) {
    console.log(
      `::error::Could not list e2e runs, so this run by hand does not start: ${r.stderr.trim()}`,
    );
    process.exit(1);
  }
  const why = refusal({ ref: REF, runs: JSON.parse(r.stdout), self: RUN_ID });
  if (why) {
    console.log(`::error::${why}`);
    process.exit(1);
  }
  console.log('No other e2e run is queued or going: this run by hand starts.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
