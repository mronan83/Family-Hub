// The Test catalogue and its CI check (NFR-18, 08 §6, D-106). Each test copies the docs and every
// test file into a temporary folder, changes something there, and runs check_traceability.py on it.
// IDs in the fixtures are built from parts, so this file's own text names no fixture ID: the check
// reads this file too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const root = join(import.meta.dirname, '..');
const id = (dom, n) => `${dom}-${n}`;
const call = (fn) => fn; // describe/it/test, written as a variable so this file's text holds no fixture test
const IT = call('it');
const TEST = call('test');
const DESCRIBE = call('describe');

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'trace-'));
  cpSync(join(root, 'docs'), join(dir, 'docs'), {
    recursive: true,
    filter: (src) => !src.includes(`${join('docs', 'guide')}`) && !src.includes('__pycache__'),
  });
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.test.*', '*.spec.*'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\n')
    .filter(Boolean);
  for (const f of files) {
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    cpSync(join(root, f), join(dir, f));
  }
  const run = (...args) =>
    spawnSync(
      'python3',
      [join(dir, 'docs', 'check_traceability.py'), '--docs', join(dir, 'docs'), ...args],
      {
        encoding: 'utf8',
      },
    );
  const write = (rel, text) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  const read = (rel) => readFileSync(join(dir, rel), 'utf8');
  const edit = (rel, from, to) => {
    const text = read(rel);
    assert.ok(text.includes(from), `${rel} has ${from}`);
    write(rel, text.replace(from, to));
  };
  // Start from a catalogue that is up to date with the copied tests.
  run('--fix');
  return { dir, run, write, read, edit };
}

const errors = (r) =>
  (r.stdout + r.stderr)
    .split('\n')
    .filter((l) => l.startsWith('ERROR'))
    .join('\n');

const known = (s) =>
  s
    .read('docs/known-test-gaps.txt')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'));

test('[NFR-18-a][US-913] a test traces to the IDs in its name and its describe blocks, in every layer', () => {
  const s = sandbox();
  const req = id('CHR', '04');
  s.write(
    'apps/web/lib/zz-fixture.test.ts',
    `${DESCRIBE}('[${req}] a group', () => {\n  ${IT}('says no ID itself', () => {});\n});\n`,
  );
  s.write(
    'e2e/ui/zz-fixture.spec.ts',
    `${TEST}('[${id('BRD', '08')}] a screen', async () => {});\n`,
  );
  s.write(
    'e2e/tests/zz-fixture.spec.ts',
    `${TEST}('[${id('US', '707')}] a flow', async () => {});\n`,
  );
  s.write(
    'supabase/tests/999_zz_fixture.test.sql',
    `select plan(1);\nselect is(1, 1,\n  '[${id('NFR', '09')}] a household''s own row');\n`,
  );
  const r = s.run('--fix');
  const doc = s.read('docs/08-test-strategy.md');
  const block = (file) => doc.slice(doc.indexOf(`#### \`${file}\``)).split('\n#### ')[0];
  assert.match(block('apps/web/lib/zz-fixture.test.ts'), /Unit · 1 tests/);
  assert.match(
    block('apps/web/lib/zz-fixture.test.ts'),
    new RegExp(`a group › says no ID itself\` \\| ${req} \\|`),
  );
  assert.match(block('e2e/ui/zz-fixture.spec.ts'), /UI · 1 tests[\s\S]*\| BRD-08 \|/);
  assert.match(block('e2e/tests/zz-fixture.spec.ts'), /E2E · 1 tests[\s\S]*\| US-707 \|/);
  assert.match(
    block('supabase/tests/999_zz_fixture.test.sql'),
    /DB · 1 tests[\s\S]*a household's own row` \| NFR-09 \|/,
  );
  assert.equal(errors(r), '', r.stdout);
});

test('[NFR-18-b][US-913] a test naming an unknown requirement, story, item or test case fails the check', () => {
  const s = sandbox();
  const names = [id('CHR', '99'), id('US', '9999'), id('WP', '99'), id('NFR', '18') + '-z'];
  s.write(
    'apps/web/lib/zz-unknown.test.ts',
    names.map((n) => `${IT}('[${n}] names it', () => {});`).join('\n') + '\n',
  );
  const r = s.run();
  assert.equal(r.status, 1);
  const e = errors(r);
  assert.match(e, /names unknown requirement CHR-99/);
  assert.match(e, /names unknown story US-9999/);
  assert.match(e, /names unknown backlog item WP-99/);
  assert.match(e, /names test case NFR-18-z, which no item's §5 table in 05 defines/);
});

test('[NFR-18-c][US-913] a new gap fails the check, and a known gap does not', () => {
  const s = sandbox();
  const before = errors(s.run());
  assert.equal(before, '', 'the copied docs pass');
  const gaps = known(s);
  assert.ok(gaps.length > 0, 'there are known gaps');

  // A Done item with no test cases: WP-86 marked Done.
  s.edit(
    'docs/05-backlog.md',
    '| WP-86 | Close the known test gaps | P3 | L | WP-85 | Ready |',
    '| WP-86 | Close the known test gaps | P3 | L | WP-85 | Done |',
  );
  // A built story no test names: a new story on NFR-18, which WP-85 (Done) builds.
  const story = id('US', '914');
  s.edit(
    'docs/03-user-stories.md',
    '\n### US-913 —',
    `\n### ${story} — A fixture story\n**As a** parent **I want** a thing **so that** it works.\n**Priority:** Must · **Phase:** P3 · **Reqs:** NFR-18\n- Given a, when b, then c.\n\n### US-913 —`,
  );
  const e = errors(s.run());
  assert.match(e, /test gap: done-when WP-86 has no test/);
  assert.match(e, new RegExp(`test gap: story ${story} has no test`));
  for (const g of gaps) assert.ok(!e.includes(`test gap: ${g} `), `known gap ${g} passes`);
});

test("[NFR-18-d][US-913] a Done item's test case with no test fails; a case of an item not built yet may wait", () => {
  const s = sandbox();
  const done = id('NFR', '18') + '-y';
  const later = id('NFR', '18') + '-x';
  s.edit(
    'docs/05-backlog.md',
    '\n- **Done when:** `08` is in the docs index',
    `| ${done} | A fixture case with no test | Unit |\n\n- **Done when:** \`08\` is in the docs index`,
  );
  s.edit(
    'docs/05-backlog.md',
    '- **Done when:** `docs/known-test-gaps.txt` lists no gap',
    `\n| Case | Test case | Layer |\n|---|---|---|\n| ${later} | A case written before its build | Unit |\n\n- **Done when:** \`docs/known-test-gaps.txt\` lists no gap`,
  );
  const e = errors(s.run());
  assert.match(e, new RegExp(`test gap: case ${done} has no test`));
  assert.ok(!e.includes(later), e);
});

test("[NFR-18-e][US-913] --fix writes the catalogue and 04's Tests column and line; the check fails while they are out of date", () => {
  const s = sandbox();
  assert.equal(errors(s.run()), '');
  s.write(
    'apps/web/lib/zz-count.test.ts',
    `${IT}('[${id('NFR', '18')}] one more test', () => {});\n`,
  );
  const e = errors(s.run());
  assert.match(e, /NFR-18: Tests column out of date/);
  assert.match(e, /04 §C: the Tests coverage line is out of date/);
  assert.match(e, /08: the Test catalogue is out of date/);
  assert.equal(errors(s.run('--fix')), '');
  assert.match(s.read('docs/08-test-strategy.md'), /zz-count\.test\.ts/);
  const row = s
    .read('docs/04-requirements-traceability.md')
    .split('\n')
    .find((l) => l.startsWith('| NFR-18 | US-913'));
  assert.match(row, /\| U \d+ \|$/);
  assert.equal(errors(s.run()), '');
});

test('[NFR-18-f][US-913] --fix takes a closed gap off the known gaps, and never adds one', () => {
  const s = sandbox();
  const gap = known(s).find((g) => g.startsWith('story '));
  assert.ok(gap, 'a known story gap');
  const story = gap.split(' ')[1];
  s.write('apps/web/lib/zz-close.test.ts', `${IT}('[${story}] closes the gap', () => {});\n`);
  assert.equal(errors(s.run('--fix')), '');
  assert.ok(!known(s).includes(gap), `${gap} is off the list`);

  s.edit(
    'docs/05-backlog.md',
    '| WP-86 | Close the known test gaps | P3 | L | WP-85 | Ready |',
    '| WP-86 | Close the known test gaps | P3 | L | WP-85 | Done |',
  );
  const r = s.run('--fix');
  assert.equal(r.status, 1);
  assert.ok(!known(s).includes('done-when WP-86'), 'a new gap is never added');
});
