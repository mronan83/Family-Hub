// [NFR-14][D-104] Which e2e specs a change runs (scripts/e2e-scope.mjs, e2e/areas.json), and that the
// map stays honest: every spec is in it, and every page a spec opens is one of its URLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globRegExp, loadAreas, routeOf, scope } from './e2e-scope.mjs';

const root = join(import.meta.dirname, '..');
const areas = loadAreas();
const specs = readdirSync(join(root, 'e2e/tests')).filter((f) => f.endsWith('.spec.ts'));
const pick = (files) => scope(files);

test('[NFR-14][D-104] a docs-only change needs no e2e', () => {
  const r = pick([
    'docs/05-backlog.md',
    'CLAUDE.md',
    '.claude/skills/deliver/SKILL.md',
    'docs/guide/img/home.jpg',
  ]);
  assert.equal(r.mode, 'none', r.reasons.join('\n'));
  assert.deepEqual(r.specs, []);
});

test('[NFR-14][D-104] tests outside e2e and CI-tested scripts need no e2e', () => {
  const r = pick([
    'apps/web/lib/chores.test.ts',
    'supabase/tests/030_goals.test.sql',
    'scripts/deploy-gate.sh',
    'e2e/ui/board.spec.ts',
  ]);
  assert.equal(r.mode, 'none', r.reasons.join('\n'));
});

test('[NFR-14][D-104] an admin page runs the specs that open it, not the board specs', () => {
  const r = pick(['apps/web/app/(admin)/admin/school/page.tsx']);
  assert.equal(r.mode, 'some');
  assert.ok(r.specs.includes('school.spec.ts'), r.specs.join());
  assert.ok(!r.specs.includes('board.spec.ts'), r.specs.join());
  assert.ok(r.specs.length < specs.length / 2, r.specs.join());
});

test('[NFR-14][D-104] a lib file runs the specs of every route that imports it, and the specs that import it', () => {
  const r = pick(['apps/web/lib/menu/import.ts']);
  assert.equal(r.mode, 'some');
  for (const s of ['menus.spec.ts', 'board-meals.spec.ts'])
    assert.ok(r.specs.includes(s), r.specs.join());
});

test('[NFR-14][D-104] the shared parts run everything', () => {
  for (const f of [
    'supabase/migrations/20990101000000_x.sql',
    'supabase/seed.sql',
    'apps/web/app/(board)/board/board.tsx',
    'apps/web/app/(admin)/layout.tsx',
    'apps/web/lib/auth/session.ts',
    'apps/web/lib/supabase/server.ts',
    'apps/web/proxy.ts',
    'e2e/support/test.ts',
    'e2e/playwright.config.ts',
    'packages/ui/src/index.ts',
    'pnpm-lock.yaml',
    '.github/workflows/e2e.yml',
  ]) {
    const r = pick([f]);
    assert.equal(r.mode, 'all', f);
    assert.equal(r.specs.length, specs.length, f);
  }
});

test('[NFR-14][D-104] a file the map cannot place, or a removed source file, runs everything', () => {
  assert.equal(pick(['tools/something-new.mjs']).mode, 'all');
  assert.equal(scope(['apps/web/lib/gone.ts'], { exists: () => false }).mode, 'all');
});

test('[NFR-14][D-105] a changed spec runs and is burnt in; a new spec must be in the map', () => {
  const r = pick(['e2e/tests/chores.spec.ts']);
  assert.deepEqual(r.specs, ['chores.spec.ts']);
  assert.deepEqual(r.burnIn, ['chores.spec.ts']);
  const both = pick(['e2e/support/test.ts', 'e2e/tests/chores.spec.ts', 'e2e/tests/meals.spec.ts']);
  assert.equal(both.mode, 'all');
  assert.deepEqual(
    both.burnIn,
    ['chores.spec.ts', 'meals.spec.ts'],
    'burnt in even when everything runs',
  );
  const unmapped = scope(['e2e/tests/brand-new.spec.ts'], { exists: () => true });
  assert.equal(unmapped.mode, 'all');
  assert.match(unmapped.reasons.at(-1), /not in e2e\/areas.json/);
});

test('[NFR-14] routes and globs', () => {
  assert.equal(routeOf('apps/web/app/(admin)/admin/chores/[id]/page.tsx'), '/admin/chores/[id]');
  assert.equal(routeOf('apps/web/app/(board)/board/today.tsx'), '/board');
  assert.equal(routeOf('apps/web/lib/chores.ts'), null);
  assert.ok(globRegExp('**/*.md').test('CLAUDE.md'));
  assert.ok(globRegExp('**/*.md').test('.claude/skills/deliver/SKILL.md'));
  assert.ok(!globRegExp('docs/*').test('docs/guide/img/a.jpg'));
  assert.ok(globRegExp('docs/**').test('docs/guide/img/a.jpg'));
});

test('[NFR-14][D-104] every spec is in e2e/areas.json, and nothing else is', () => {
  assert.deepEqual(Object.keys(areas.specs).sort(), [...specs].sort());
});

// The pages a spec opens by URL, by Settings tile or from the admin menu, against its URLs in the map.
const SETTINGS = {
  'Family options': '/admin/settings/family',
  School: '/admin/school',
  Calendars: '/admin/calendars',
  Boards: '/admin/devices',
  Tags: '/admin/tags',
  Reminders: '/admin/reminders',
  Health: '/admin/health',
};
const MENU = {
  Home: '/admin',
  Today: '/admin/today',
  'My tasks': '/admin/my',
  Chores: '/admin/chores',
  Goals: '/admin/goals',
  Rewards: '/admin/rewards',
  Meals: '/admin/meals',
  Members: '/admin/members',
  Insights: '/admin/insights',
  Settings: '/admin/settings',
};

test('[NFR-14][D-104] each page a spec opens is one of its URLs in e2e/areas.json', () => {
  const missing = [];
  for (const spec of specs) {
    const text = readFileSync(join(root, 'e2e/tests', spec), 'utf8');
    const opened = [
      ...[...text.matchAll(/\.goto\(\s*[`'"](\/[^`'"$?#]*)/g)].map((m) => m[1]),
      ...[...text.matchAll(/openSetting\(\s*\w+,\s*'([^']+)'/g)].map(
        (m) => SETTINGS[m[1]] ?? `setting ${m[1]}`,
      ),
      ...[...text.matchAll(/openFromMenu\(\s*\w+,\s*'([^']+)'/g)].map(
        (m) => MENU[m[1]] ?? `menu ${m[1]}`,
      ),
    ].map((u) => u.replace(/\/$/, '') || '/');
    for (const url of opened) {
      if (url === '/sign-in') continue; // every spec signs in; sign-in is shared (runs everything)
      const covered = (areas.specs[spec] ?? []).some((u) => url === u || url.startsWith(`${u}/`));
      if (!covered) missing.push(`${spec}: ${url}`);
    }
  }
  assert.deepEqual(missing, [], 'add these URLs to the spec in e2e/areas.json');
});
