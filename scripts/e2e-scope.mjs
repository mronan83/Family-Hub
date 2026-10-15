#!/usr/bin/env node
// [NFR-14][D-104] Which e2e specs a pull request's preview runs (01 §9.5). A pull request runs only
// the specs for the areas its diff touches; the full suite runs on main after each deploy and nightly
// (e2e-main.yml), so every test still runs on main.
//
//   none  nothing the e2e suite exercises changed (docs, *.md, guide images, CI-tested scripts)
//   some  only the specs whose URLs cover what changed (e2e/areas.json)
//   all   anything shared: the board shell, the admin shell, auth, migrations, the seed, e2e support,
//         or a file the map can't place
//
// A changed app or lib file runs the specs that cover its own route and the route of every file that
// imports it, followed through imports within apps/web and from e2e specs. A changed spec runs, and
// is burnt in: run five times in a row before the pull request is ready.
//
//   node scripts/e2e-scope.mjs --base origin/main [--head HEAD] [--github-output FILE]
//   git diff --name-only ... | node scripts/e2e-scope.mjs --files -
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = 'apps/web';
const SPECS = 'e2e/tests';

/** A glob ("**", "*") as a regular expression over a repository path. */
export function globRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

const matcher = (globs) => {
  const res = globs.map(globRegExp);
  return (path) => res.some((r) => r.test(path));
};

/** The URL a file under apps/web/app serves, without route groups: "(admin)/admin/chores/[id]/page.tsx" → "/admin/chores/[id]". */
export function routeOf(path) {
  if (!path.startsWith(`${WEB}/app/`)) return null;
  const parts = path
    .slice(`${WEB}/app/`.length)
    .split('/')
    .slice(0, -1)
    .filter((p) => !/^\(.*\)$/.test(p));
  return `/${parts.join('/')}`;
}

const isTest = (path) => /\.test\.(ts|tsx|mjs|js)$/.test(path) || path.includes('/__fixtures__/');
const isLayout = (path) => /\/layout\.(tsx|ts)$/.test(path);

/** Spec names whose URLs cover `url`. A layout covers everything beneath it. */
function specsFor(areas, url, layout) {
  const under = (a, b) => a === b || a.startsWith(b === '/' ? '/' : `${b}/`);
  return Object.entries(areas.specs)
    .filter(([, urls]) => urls.some((u) => under(url, u) || (layout && under(u, url))))
    .map(([spec]) => spec);
}

const SOURCE = /\.(ts|tsx|mjs|js|css|json)$/;
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir, out = []) {
  if (!existsSync(join(ROOT, dir))) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name === '.next') continue;
    const p = posix.join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else if (SOURCE.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from, spec, files) {
  let base;
  if (spec.startsWith('@/')) base = posix.join(WEB, spec.slice(2));
  else if (spec.startsWith('.')) base = posix.join(posix.dirname(from), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '.mjs', '.js', '.json', '/index.ts', '/index.tsx']) {
    if (files.has(base + ext)) return base + ext;
  }
  return null;
}

/** importer graph: path → the files that import it, over apps/web and the e2e specs. */
export function importers(root = ROOT) {
  const files = new Set([...walk(WEB), ...walk(SPECS)]);
  const by = new Map();
  for (const f of files) {
    const text = readFileSync(join(root, f), 'utf8');
    for (const m of text.matchAll(IMPORT)) {
      const target = resolveImport(f, m[1] ?? m[2] ?? m[3] ?? m[4], files);
      if (!target) continue;
      if (!by.has(target)) by.set(target, new Set());
      by.get(target).add(f);
    }
  }
  return by;
}

export function loadAreas(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'e2e/areas.json'), 'utf8'));
}

/**
 * The e2e scope of a change: { mode: 'none' | 'some' | 'all', specs, burnIn, reasons }.
 * `exists(path)` says whether a changed path is still there (a deleted source file runs everything).
 */
export function scope(changed, { areas = loadAreas(), graph = importers(), exists } = {}) {
  const full = matcher(areas.full);
  const none = matcher(areas.none);
  const there = exists ?? ((p) => existsSync(join(ROOT, p)));
  const known = new Set(Object.keys(areas.specs));
  const specs = new Set();
  const burnIn = new Set();
  const reasons = [];
  // Anything shared runs every spec; the loop still looks at every path, so each changed spec is burnt in.
  let everything = null;
  const all = (why) => {
    everything ??= why;
  };

  for (const path of changed) {
    if (path.startsWith(`${SPECS}/`)) {
      const name = path.slice(SPECS.length + 1);
      if (!there(path)) continue; // a spec taken out: nothing to run
      if (!known.has(name)) {
        all(`${path} is not in e2e/areas.json`);
        continue;
      }
      specs.add(name);
      burnIn.add(name);
      reasons.push(`${path}: changed spec, burnt in`);
      continue;
    }
    if (full(path)) {
      all(`${path} is shared`);
      continue;
    }
    if (none(path)) continue;
    if (!path.startsWith(`${WEB}/app/`) && !path.startsWith(`${WEB}/lib/`)) {
      all(`${path} is not in e2e/areas.json`);
      continue;
    }
    if (isTest(path)) continue;
    if (!there(path)) {
      all(`${path} was removed`);
      continue;
    }

    // Follow importers up to the routes and specs that use the file.
    const seen = new Set([path]);
    const queue = [path];
    const found = new Set();
    while (queue.length) {
      const f = queue.shift();
      if (f.startsWith(`${SPECS}/`)) {
        const name = f.slice(SPECS.length + 1);
        if (known.has(name)) found.add(name);
        continue;
      }
      if (f !== path && full(f)) {
        // A shell that imports it: the specs under the shell's route, not everything.
        const url = routeOf(f);
        if (url) for (const s of specsFor(areas, url, true)) found.add(s);
        continue;
      }
      const url = routeOf(f);
      if (url) for (const s of specsFor(areas, url, isLayout(f))) found.add(s);
      const up = [...(graph.get(f) ?? [])].filter((g) => !isTest(g));
      if (!url && up.length === 0 && f === path) {
        all(`${path} is used by no route the map knows`);
        break;
      }
      for (const g of up) {
        if (!seen.has(g)) {
          seen.add(g);
          queue.push(g);
        }
      }
    }
    for (const s of found) specs.add(s);
    reasons.push(`${path}: ${found.size ? [...found].sort().join(', ') : 'no spec'}`);
  }
  if (everything) {
    return {
      mode: 'all',
      specs: [...known].sort(),
      burnIn: [...burnIn].sort(),
      reasons: [...reasons, everything],
    };
  }
  return {
    mode: specs.size ? 'some' : 'none',
    specs: [...specs].sort(),
    burnIn: [...burnIn].sort(),
    reasons,
  };
}

function changedFiles(base, head) {
  const mergeBase = execFileSync('git', ['merge-base', base, head], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  return execFileSync('git', ['diff', '--name-only', '--no-renames', mergeBase, head], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const files =
    arg('--files') === '-'
      ? readFileSync(0, 'utf8')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : changedFiles(arg('--base') ?? 'origin/main', arg('--head') ?? 'HEAD');
  const result = { changed: files.length, ...scope(files) };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const out = arg('--github-output');
  if (out) {
    appendFileSync(
      out,
      `mode=${result.mode}\nspecs=${result.specs.join(' ')}\nburn_in=${result.burnIn.join(' ')}\n`,
    );
  }
}
