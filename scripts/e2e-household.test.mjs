// [NFR-14][D-137] Each e2e spec's own household (scripts/e2e-household.mjs, WP-111).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkKey,
  createSql,
  demoPassword,
  householdId,
  ownId,
  passwordSql,
  personaEmail,
  prefixOf,
  removeSql,
} from './e2e-household.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPECS = join(ROOT, 'e2e/tests');
/** A demo family sign-in, `alex@demo.familywise.invalid`, and not a copy (`alex+chores@…`). */
const DEMO_SIGN_IN = /(^|[^+\w-])[a-z]+@demo\.familywise\.invalid/;

test('[NFR-14-u] a spec household is the seed under its own ids and sign-ins, and nothing of the demo family', () => {
  const seed = readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8');
  const sql = createSql('chores', seed);
  const prefix = prefixOf('chores');
  assert.match(prefix, /^[0-9a-f]{8}$/);
  assert.notEqual(prefix, '0de00000');
  assert.equal(householdId('chores'), `${prefix}-0000-4000-8000-000000000001`);
  assert.equal(
    ownId('chores', '0de00000-0000-4000-8000-0000000c0001'),
    `${prefix}-0000-4000-8000-0000000c0001`,
  );
  // Every id and sign-in of the demo family becomes the spec's own; none is left.
  assert.ok(!sql.includes('0de00000'), 'a demo family id is left in the copy');
  assert.ok(!DEMO_SIGN_IN.test(sql), 'a demo family sign-in is left');
  for (const who of ['alex', 'sam', 'jordan', 'riley']) {
    assert.ok(sql.includes(`'${who}+chores@demo.familywise.invalid'`), `${who}'s copy is missing`);
  }
  // The seed's own clean-up (every demo sign-in, every household they set up) is not in the copy.
  assert.ok(!sql.includes("email like '%@demo.familywise.invalid'"));
  // The copy is everything from the household on, with the same statements as the seed's.
  const count = (s, re) => (s.match(re) ?? []).length;
  const body = seed.slice(
    seed.indexOf('insert into public.household (id, name, timezone, is_demo)'),
  );
  assert.equal(count(sql, /\binsert into\b/g), count(body, /\binsert into\b/g));
  // It starts by taking away the spec's household from a run or a try before.
  assert.ok(sql.startsWith(removeSql('chores')));
  assert.throws(() => createSql('chores'), /needs the text/);
  // Two specs never share an id prefix.
  const keys = readdirSync(SPECS)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => f.replace(/\.spec\.ts$/, ''));
  assert.equal(new Set(keys.map(prefixOf)).size, keys.length);
});

test('[NFR-14-u] keys, ids and personas outside the rules are refused', () => {
  for (const key of ['', 'Chores', 'a b', "x'; drop table household; --", 'a'.repeat(41), '1st']) {
    assert.throws(() => checkKey(key), /not a spec household key/);
  }
  assert.throws(() => ownId('chores', '99999999-0000-4000-8000-000000000001'), /not a seed id/);
  assert.throws(() => personaEmail('chores', 'noa'), /not a demo persona/);
  assert.throws(() => createSql('chores', '-- no household here'), /no longer has/);
  assert.throws(
    () =>
      createSql(
        'chores',
        "insert into public.household (id, name, timezone, is_demo) values ('x'); select 0de00000;",
      ),
    /names a demo id/,
  );
});

test('[NFR-14-u] each sign-in gets the password the preview derives for it, and only the spec’s', () => {
  const sql = passwordSql('chores', 'test-secret');
  // The same vector is asserted for the app (apps/web/app/(admin)/sign-in/actions.test.ts).
  assert.equal(
    demoPassword('test-secret', 'alex+chores@demo.familywise.invalid'),
    'b6bc796be5e4e92f3d719148c185fdb6e5c27143477b81f552700887d8b1aa4d',
  );
  assert.ok(sql.includes("('alex+chores@demo.familywise.invalid', 'b6bc796be5e4e92f"));
  assert.equal(
    (sql.match(/\+chores@demo\.familywise\.invalid', '[0-9a-f]{64}'\)/g) ?? []).length,
    4,
  );
  assert.ok(!sql.includes('test-secret'), 'the secret itself is never in the SQL');
});

test('[NFR-14-x] every spec that signs in or reaches the database owns a household, and none names the demo family’s ids or sign-ins', () => {
  // A spec that only asks the preview for a page or an endpoint needs no data (jobs, smoke).
  const reaches = /SUPABASE_DB_URL|support\/(?:session|board|db|day|school|history)'/;
  let owners = 0;
  for (const file of readdirSync(SPECS).filter((f) => f.endsWith('.spec.ts'))) {
    const text = readFileSync(join(SPECS, file), 'utf8');
    if (file === 'auth.spec.ts') {
      // It tests the preview's one-tap into the demo family, and is the only spec that uses it.
      assert.ok(!text.includes('ownHousehold('), 'auth.spec.ts uses the demo family itself');
      continue;
    }
    const key = file.replace(/\.spec\.ts$/, '');
    if (reaches.test(text)) {
      assert.ok(text.includes(`ownHousehold('${key}')`), `${file} has no ownHousehold('${key}')`);
      owners++;
    }
    // A seed id appears only as an argument of own(), which turns it into the spec's copy.
    const bare = text.replace(/\.own\(\s*'0de00000-[0-9a-f%-]*'\s*\)/g, '');
    assert.ok(!bare.includes('0de00000'), `${file} names a demo family id outside own()`);
    assert.ok(!DEMO_SIGN_IN.test(text), `${file} names a demo family sign-in`);
  }
  assert.ok(owners > 30, `only ${owners} specs own a household`);
});
