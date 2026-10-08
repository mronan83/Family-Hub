// What the repository actually contains, so the pages can show built versus specified:
// git position, tagged tests, migrations (tables, columns, RLS, policies), routes, packages, workflows.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIP = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const TAG_RX = /\[((?:ACC|DEV|CHR|RWD|CAL|SCH|MEAL|MENU|BRD|PTS|NFR)-\d{2}|US-\d{3,4})\]/g;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const git = (root, ...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
};

export function gitInfo(root) {
  const sha = process.env.GITHUB_SHA || git(root, 'rev-parse', 'HEAD');
  let branch =
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME ||
    git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  if (branch === 'HEAD') branch = '';
  const date = git(root, 'log', '-1', '--format=%cI', sha) || new Date().toISOString();
  const subject = git(root, 'log', '-1', '--format=%s', sha);
  return { sha, short: sha.slice(0, 7), branch, date, subject };
}

// ---------------------------------------------------------------------------
// Tests tagged with requirement or story IDs
// ---------------------------------------------------------------------------

function testKind(file) {
  if (file.endsWith('.sql')) return 'pgTAP';
  if (file.includes('/e2e/') || file.startsWith('e2e/')) return 'Playwright';
  return 'Vitest';
}

export function scanTests(root) {
  const files = walk(root)
    .map((p) => relative(root, p))
    .filter((f) => /\.(test|spec)\./.test(f));
  const tests = [];
  for (const file of files.sort()) {
    const lines = readFileSync(join(root, file), 'utf8').split('\n');
    const kind = testKind(file);
    const entry = { file, kind, tags: new Set(), cases: [] };
    const plan = lines.join('\n').match(/select plan\((\d+)\)/);
    lines.forEach((line, i) => {
      const ids = [...line.matchAll(TAG_RX)].map((m) => m[1]);
      if (!ids.length) return;
      ids.forEach((id) => entry.tags.add(id));
      const quoted = line.match(/'((?:[^']|'')*\[[A-Z]+-\d+\](?:[^']|'')*)'/);
      const isSuite = /^\s*(--|\/\/)|describe\(/.test(line);
      if (quoted && !isSuite) {
        const name = quoted[1].replace(/''/g, "'").replace(TAG_RX, '').trim();
        entry.cases.push({ line: i + 1, ids, name });
      }
    });
    entry.count = plan ? Number(plan[1]) : entry.cases.length;
    tests.push(entry);
  }
  return tests;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function splitTop(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  let quote = false;
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === '(') depth++;
    if (!quote && ch === ')') depth--;
    if (!quote && depth === 0 && ch === ',') {
      parts.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function readParens(sql, start) {
  let depth = 0;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(start + 1, i);
  }
  return '';
}

const tkey = (schema, name) => (schema === 'public' ? name : `${schema}.${name}`);
const CONSTRAINT = /^(constraint|check|primary key|unique|foreign key|exclude)\b/i;

function parseColumn(def) {
  const clean = def.replace(/--.*$/gm, '').replace(/\s+/g, ' ').trim();
  const m = clean.match(/^([a-z_][a-z0-9_]*)\s+([a-z0-9_]+(?:\s*\[\])?(?:\s*\([^)]*\))?)\s*(.*)$/i);
  if (!m) return null;
  const rest = m[3];
  const ref = rest.match(/references\s+([a-z_.]+)/i);
  const dflt = rest.match(/default\s+((?:[^\s(]+(?:\([^)]*\))?)(?:::[a-z]+)?)/i);
  const check = rest.match(/check\s*\((.*)\)\s*$/i);
  return {
    name: m[1],
    type: m[2].replace(/\s+/g, ''),
    pk: /primary key/i.test(rest),
    notNull: /not null|primary key/i.test(rest),
    unique: /\bunique\b/i.test(rest),
    ref: ref ? ref[1].replace(/^public\./, '') : null,
    default: dflt ? dflt[1] : null,
    check: check ? check[1] : null,
  };
}

export function scanMigrations(root) {
  const dir = join(root, 'supabase/migrations');
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort()
    : [];
  const tables = new Map();
  const functions = [];
  const migrations = [];
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    const created = [];
    for (const m of sql.matchAll(/create table (?:if not exists )?([a-z_]+)\.([a-z_]+)\s*\(/gi)) {
      const [schema, name] = [m[1], m[2]];
      const key = tkey(schema, name);
      const body = readParens(sql, m.index + m[0].length - 1);
      const parts = splitTop(body);
      const columns = parts
        .filter((p) => !CONSTRAINT.test(p))
        .map(parseColumn)
        .filter(Boolean);
      const constraints = parts
        .filter((p) => CONSTRAINT.test(p))
        .map((p) => p.replace(/\s+/g, ' '));
      tables.set(key, {
        name,
        schema,
        file: `supabase/migrations/${f}`,
        columns,
        constraints,
        rls: false,
        policies: [],
        triggers: [],
        realtime: false,
      });
      created.push(key);
    }
    for (const m of sql.matchAll(
      /alter table ([a-z_]+)\.([a-z_]+)\s+enable row level security/gi,
    )) {
      const t = tables.get(tkey(m[1], m[2]));
      if (t) t.rls = true;
    }
    for (const m of sql.matchAll(
      /create policy ([a-z_]+) on ([a-z_]+)\.([a-z_]+)\s+for (\w+)\s+to ([a-z_, ]+?)\s*(?:using|with check)/gi,
    )) {
      tables
        .get(tkey(m[2], m[3]))
        ?.policies.push({ name: m[1], cmd: m[4].toLowerCase(), roles: m[5].trim() });
    }
    for (const m of sql.matchAll(
      /create trigger ([a-z_]+) (before|after) ([a-z ,_]+?) on ([a-z_]+)\.([a-z_]+)/gi,
    )) {
      tables.get(tkey(m[4], m[5]))?.triggers.push({ name: m[1], when: `${m[2]} ${m[3].trim()}` });
    }
    const pub = sql.match(/alter publication supabase_realtime\s+add table ([^;]+);/i);
    for (const t of pub ? pub[1].split(',') : []) {
      const hit = tables.get(t.trim().replace(/^public\./, ''));
      if (hit) hit.realtime = true;
    }
    const fns = [];
    for (const m of sql.matchAll(
      /create (?:or replace )?function ([a-z_]+)\.([a-z_]+)\(([^)]*)\)\s*returns ([a-z_ .]+?)\s*\n?\s*language (\w+)([^$]*?)as \$\$/gi,
    )) {
      const fn = {
        name: `${m[1]}.${m[2]}`,
        args: m[3].trim(),
        returns: m[4].trim(),
        language: m[5],
        definer: /security definer/i.test(m[6]),
        file: `supabase/migrations/${f}`,
      };
      functions.push(fn);
      fns.push(fn.name);
    }
    const lines = sql.split('\n');
    const lead = lines.slice(
      0,
      Math.max(
        0,
        lines.findIndex((l) => !l.startsWith('--')),
      ),
    );
    const header = lead.map((l) => l.replace(/^--\s*/, '')).join(' ');
    migrations.push({
      file: `supabase/migrations/${f}`,
      title: header.split(/\.\s/)[0].replace(/\.$/, ''),
      tables: created,
      functions: fns,
      lines: sql.split('\n').length,
    });
  }
  return { tables, functions, migrations };
}

// ---------------------------------------------------------------------------
// App routes, packages, workflows
// ---------------------------------------------------------------------------

export function scanRoutes(root) {
  const base = join(root, 'apps/web/app');
  return walk(base)
    .map((p) => relative(base, p))
    .filter((f) => /(^|\/)(page|route)\.tsx?$/.test(f))
    .map((f) => {
      const path =
        '/' +
        f
          .split('/')
          .slice(0, -1)
          .filter((s) => !/^\(.*\)$/.test(s))
          .join('/');
      const group = (f.match(/^\(([^)]+)\)/) || [])[1] || (f.startsWith('api/') ? 'api' : 'root');
      return {
        path: path === '/' ? '/' : path,
        kind: f.includes('route.') ? 'API' : 'Page',
        group,
        file: `apps/web/app/${f}`,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function scanPackages(root) {
  const out = [];
  for (const dir of ['apps', 'packages']) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const pj = join(base, name, 'package.json');
      if (!existsSync(pj)) continue;
      const pkg = JSON.parse(readFileSync(pj, 'utf8'));
      const src = walk(join(base, name)).filter(
        (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith('.d.ts'),
      );
      out.push({
        name: pkg.name,
        dir: `${dir}/${name}`,
        files: src.length,
        tests: src.filter((p) => /\.(test|spec)\./.test(p)).length,
        deps: Object.keys(pkg.dependencies || {}),
      });
    }
  }
  return out;
}

export function scanWorkflows(root) {
  const dir = join(root, '.github/workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => {
      const text = readFileSync(join(dir, f), 'utf8');
      const lines = text.split('\n');
      const purpose = lines
        .filter((l) => l.startsWith('#'))
        .map((l) => l.replace(/^#\s?/, ''))
        .join(' ');
      const name = (text.match(/^name:\s*(.+)$/m) || [])[1] || f;
      const onIdx = lines.findIndex((l) => /^on:/.test(l));
      const triggers = [];
      for (let i = onIdx + 1; onIdx >= 0 && i < lines.length && !/^\S/.test(lines[i]); i++) {
        const m = lines[i].match(/^ {2}([a-z_]+):/);
        if (m) triggers.push(m[1]);
      }
      const cron = (text.match(/cron:\s*'([^']+)'/) || [])[1];
      const jobsIdx = lines.findIndex((l) => /^jobs:/.test(l));
      const jobs = [];
      for (let i = jobsIdx + 1; jobsIdx >= 0 && i < lines.length; i++) {
        const m = lines[i].match(/^ {2}([a-z0-9_-]+):\s*$/);
        if (m) jobs.push(m[1]);
      }
      return { file: `.github/workflows/${f}`, name, purpose, triggers, cron, jobs };
    });
}
