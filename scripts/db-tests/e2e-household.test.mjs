// [NFR-14][D-136] Each e2e spec's own household on native Postgres (CI database job; no Docker),
// as e2e/support/household.ts makes it: on a throwaway database with the Supabase compatibility
// bootstrap, the migrations and the demo family (scripts/preview-db.sh), two spec households are
// made, made again and taken away. Uses the libpq variables like scripts/db-test.sh.
//
//   node --test scripts/db-tests/*.test.mjs
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSql,
  householdId,
  oneTrip,
  ownId,
  passwordSql,
  personaEmail,
  removeSql,
} from '../e2e-household.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const DB = `e2e_household_test_${process.pid}`;
const DEMO = '0de00000-0000-4000-8000-000000000001';
const SECRET = 'test-secret';
const url = () =>
  `postgresql://${process.env.PGUSER ?? 'postgres'}${process.env.PGPASSWORD ? `:${process.env.PGPASSWORD}` : ''}@${process.env.PGHOST ?? 'localhost'}:${process.env.PGPORT ?? '5432'}/${DB}`;

const admin = (q) =>
  execFileSync(
    'psql',
    [
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-d',
      process.env.PGDATABASE_ADMIN ?? 'postgres',
      '-c',
      q,
    ],
    {
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );
const q = (query) =>
  execFileSync('psql', [url(), '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-c', query], {
    encoding: 'utf8',
  }).trim();
// As e2e/support/household.ts sends it: the whole script as one query.
const script = (sql) =>
  execFileSync('psql', [url(), '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: oneTrip(sql),
    stdio: ['pipe', 'ignore', 'pipe'],
  });
const SEED = readFileSync(join(ROOT, 'supabase/seed.sql'), 'utf8');
const make = (key) => script(`${createSql(key, SEED)}\n${passwordSql(key, SECRET)}`);

/** What a household holds, as one line that changes if any of it does. */
const holds = (id) =>
  q(`select concat_ws(' ',
       (select count(*) from public.member where household_id = '${id}'),
       (select count(*) from public.household_user where household_id = '${id}'),
       (select count(*) from public.tag where household_id = '${id}'),
       (select count(*) from public.chore where household_id = '${id}'),
       (select count(*) from public.chore_assignee where household_id = '${id}'),
       (select count(*) from public.chore_occurrence where household_id = '${id}'),
       (select count(*) from public.chore_completion_event e join public.chore_occurrence o
                  on o.id = e.occurrence_id where o.household_id = '${id}'),
       (select count(*) from public.points_ledger where household_id = '${id}'),
       (select count(*) from public.reward_catalog_item where household_id = '${id}'),
       (select count(*) from public.redemption where household_id = '${id}'),
       (select count(*) from public.reward_goal where household_id = '${id}'),
       (select count(*) from public.school_year where household_id = '${id}'),
       (select count(*) from public.meal_plan_entry where household_id = '${id}'),
       (select count(*) from public.school_menu_day where household_id = '${id}'))`);

before(() => {
  admin(`drop database if exists ${DB} with (force)`);
  admin(`create database ${DB}`);
  admin(`alter database ${DB} set search_path = "$user", public, extensions`);
  const bootstrap = join(ROOT, 'supabase/tests/bootstrap');
  for (const f of readdirSync(bootstrap)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    execFileSync('psql', [url(), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(bootstrap, f)], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  }
  execFileSync('bash', [join(ROOT, 'scripts/preview-db.sh')], {
    env: { ...process.env, SUPABASE_DB_URL: url(), VERCEL_AUTOMATION_BYPASS_SECRET: SECRET },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
});

after(() => admin(`drop database if exists ${DB} with (force)`));

test('[NFR-14-v] two spec households, next to the demo family, each hold what it holds and only their own rows', () => {
  const demo = holds(DEMO);
  make('alpha');
  make('beta');
  for (const key of ['alpha', 'beta']) {
    const id = householdId(key);
    assert.equal(holds(id), demo, `${key} holds what the demo family holds`);
    // Its people and items, by the seed's names and its own ids.
    assert.equal(
      q(
        `select string_agg(display_name, ',' order by display_name) from public.member where household_id = '${id}'`,
      ),
      'Alex,Leo,Maya,Sam',
    );
    assert.equal(
      q(
        `select title from public.chore where id = '${ownId(key, '0de00000-0000-4000-8000-0000000c0001')}'`,
      ),
      'Make bed',
    );
    // Its admins and members sign in as its own copies of the demo sign-ins, with the derived passwords.
    assert.equal(
      q(`select string_agg(u.email || ':' || hu.role, ',' order by u.email)
           from public.household_user hu join auth.users u on u.id = hu.user_id
          where hu.household_id = '${id}'`),
      `${personaEmail(key, 'alex')}:owner,${personaEmail(key, 'sam')}:admin`,
    );
    assert.equal(
      q(`select count(*) from auth.users
          where email like '%+${key}@demo.familywise.invalid'
            and encrypted_password = extensions.crypt(encode(extensions.hmac('familywise demo sign-in ' || email, '${SECRET}', 'sha256'), 'hex'), encrypted_password)`),
      '4',
    );
  }
  // No row of a household points at another's: every assignee, tag, event and pin is its own.
  assert.equal(
    q(`select (select count(*) from public.chore_assignee a join public.member m on m.id = a.member_id
                 where m.household_id <> a.household_id)
          + (select count(*) from public.chore_tag t join public.tag g on g.id = t.tag_id
                 where g.household_id <> t.household_id)
          + (select count(*) from public.chore_occurrence o join public.chore c on c.id = o.chore_id
                 where c.household_id <> o.household_id)
          + (select count(*) from public.wishlist_pin p join public.reward_catalog_item r on r.id = p.catalog_item_id
                 where r.household_id <> p.household_id)
          + (select count(*) from public.member m join auth.users u on u.id = m.user_id
                 where not exists (select from public.household_user hu
                                    where hu.user_id = u.id and hu.household_id = m.household_id))`),
    '0',
  );
  assert.equal(holds(DEMO), demo, 'the demo family is as it was');
});

test('[NFR-14-v] making a spec household again starts it afresh, and leaves the others as they are', () => {
  make('alpha');
  make('beta');
  const fresh = holds(householdId('alpha'));
  const tag = (key, name) =>
    q(`insert into public.tag (household_id, name, color, icon, sort_order)
       values ('${householdId(key)}', '${name}', 'member-1', 'sun', 9) returning id`);
  tag('alpha', 'Left by a try before');
  tag('beta', 'Beta’s own');
  const beta = holds(householdId('beta'));
  make('alpha');
  assert.equal(holds(householdId('alpha')), fresh);
  assert.equal(q(`select count(*) from public.tag where name = 'Left by a try before'`), '0');
  assert.equal(holds(householdId('beta')), beta, 'beta keeps its own rows');
});

test('[NFR-14-v] taking a spec household away takes what it set up, and nothing of the demo family or another spec', () => {
  make('alpha');
  make('beta');
  const demo = holds(DEMO);
  const beta = holds(householdId('beta'));
  // A household alpha's Riley set up (as auth.spec.ts and members.spec.ts have a parent do).
  const riley = q(`select id from auth.users where email = '${personaEmail('alpha', 'riley')}'`);
  q(`insert into public.household (id, name, timezone, is_demo)
       values ('99999999-0000-4000-8000-000000000001', 'Riley’s', 'UTC', true);
     insert into public.household_user (household_id, user_id, role)
       values ('99999999-0000-4000-8000-000000000001', '${riley}', 'owner')`);
  script(removeSql('alpha'));
  assert.equal(
    q(`select count(*) from public.household
        where id in ('${householdId('alpha')}', '99999999-0000-4000-8000-000000000001')`),
    '0',
  );
  assert.equal(
    q(`select count(*) from auth.users where email like '%+alpha@demo.familywise.invalid'`),
    '0',
  );
  assert.equal(holds(householdId('beta')), beta);
  assert.equal(holds(DEMO), demo);
  assert.equal(
    q(`select count(*) from auth.users where email like '%@demo.familywise.invalid'`),
    '8',
  );
});
