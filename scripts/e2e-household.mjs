#!/usr/bin/env node
// [NFR-14][D-136] Each e2e spec's own made-up household (WP-110), on the test database only.
//
// A spec file gets a copy of the demo family (supabase/seed.sql: the same made-up members, items,
// rewards, goals, meals and menus, the same dates from today), under ids and sign-ins of its own:
//
//   - its key is the spec's file name without `.spec.ts` (`chores` for chores.spec.ts);
//   - every seed id `0de00000-…` becomes `<8 hex>-…`, the 8 hex digits taken from the key, so a
//     spec knows its ids before it runs, and one seed id names the same thing in every copy;
//   - every demo sign-in `<who>@demo.familywise.invalid` becomes `<who>+<key>@demo.familywise.invalid`.
//
// No spec sees another's rows, and none needs the demo family as the seed left it: previews and
// auth.spec.ts (which tests the preview's one-tap into the demo family) keep the demo family itself.
//
//   node scripts/e2e-household.mjs create <key>   prints the SQL that makes the household afresh
//   node scripts/e2e-household.mjs remove <key>   prints the SQL that takes it away
//
// The passwords are not in that SQL: e2e/support/household.ts adds them (passwordSql), from the
// bypass secret, as scripts/preview-db.sh does for the demo family.
// No `import.meta` here: e2e specs load this file through Playwright's CommonJS transform, where it
// is not defined. The caller reads supabase/seed.sql and passes its text.
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** The demo family's id prefix and sign-in domain, as supabase/seed.sql writes them. */
export const DEMO_PREFIX = '0de00000';
const DOMAIN = '@demo.familywise.invalid';
/** The demo sign-ins each copy has (supabase/seed.sql). */
export const PERSONAS = ['alex', 'sam', 'jordan', 'riley'];
/** Where the seed's household starts; everything above it is the demo family's own clean-up. */
const BODY_START = 'insert into public.household (id, name, timezone, is_demo)';

/** A spec's key: its file name without `.spec.ts`, lowercase letters, digits and hyphens. */
export function checkKey(key) {
  if (typeof key !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(key)) {
    throw new Error(`not a spec household key: ${JSON.stringify(key)}`);
  }
  return key;
}

/** The 8 hex digits a spec's ids start with: from its key, never the demo family's. */
export function prefixOf(key) {
  checkKey(key);
  for (let n = 0; ; n++) {
    const hex = createHash('sha256')
      .update(`familywise e2e household ${key}${n ? ` ${n}` : ''}`)
      .digest('hex')
      .slice(0, 8);
    if (hex !== DEMO_PREFIX) return hex;
  }
}

/** The spec's copy of a seed id ('0de00000-…'), or of a LIKE pattern over seed ids. */
export function ownId(key, seedId) {
  if (typeof seedId !== 'string' || !seedId.startsWith(`${DEMO_PREFIX}-`)) {
    throw new Error(`not a seed id: ${JSON.stringify(seedId)}`);
  }
  return prefixOf(key) + seedId.slice(DEMO_PREFIX.length);
}

/** The spec's household id: its copy of the demo family's. */
export function householdId(key) {
  return ownId(key, `${DEMO_PREFIX}-0000-4000-8000-000000000001`);
}

/** The spec's copy of a demo sign-in: `alex+<key>@demo.familywise.invalid`. */
export function personaEmail(key, persona) {
  checkKey(key);
  if (!PERSONAS.includes(persona)) throw new Error(`not a demo persona: ${persona}`);
  return `${persona}+${key}${DOMAIN}`;
}

/** The SQL that takes the spec's household away: it, any household its sign-ins set up, and them. */
export function removeSql(key) {
  const id = householdId(key);
  const mine = `%+${checkKey(key)}${DOMAIN}`;
  return `-- e2e household ${key}: taken away.
delete from public.household h
 where h.id = '${id}'
    or (exists (select from public.household_user hu join auth.users u on u.id = hu.user_id
                 where hu.household_id = h.id and u.email like '${mine}')
        and not exists (select from public.household_user hu join auth.users u on u.id = hu.user_id
                         where hu.household_id = h.id and u.email not like '%${DOMAIN}'));
delete from auth.users where email like '${mine}';
-- Boards whose device row went with it: their sign-ins go too (as supabase/seed.sql does).
delete from auth.users u
 where u.email like 'device-%@devices.familywise.invalid'
   and not exists (select from public.device d where d.auth_user_id = u.id);
`;
}

/** The SQL that makes the spec's household afresh: the seed's demo family, under its ids and sign-ins. */
export function createSql(key, seed) {
  if (typeof seed !== 'string') throw new Error('createSql needs the text of supabase/seed.sql');
  const start = seed.indexOf(BODY_START);
  if (start < 0) throw new Error(`supabase/seed.sql no longer has "${BODY_START}"`);
  const body = seed
    .slice(start)
    .replaceAll(`'${DEMO_PREFIX}-`, `'${prefixOf(key)}-`)
    .replaceAll(`:${DEMO_PREFIX}-`, `:${prefixOf(key)}-`)
    .replaceAll(DOMAIN, `+${checkKey(key)}${DOMAIN}`);
  if (body.includes(DEMO_PREFIX)) {
    throw new Error(`supabase/seed.sql names a demo id this copy can't own: ${DEMO_PREFIX}`);
  }
  return `${removeSql(key)}
-- e2e household ${key}: the demo family's seed, under its own ids and sign-ins.
${body}`;
}

/** The demo sign-in password for an email (lib/auth/demo.ts demoPassword, scripts/preview-db.sh). */
export function demoPassword(secret, email) {
  return createHmac('sha256', secret).update(`familywise demo sign-in ${email}`).digest('hex');
}

/** The SQL that gives the spec's sign-ins their passwords; fails if any is left without one. */
export function passwordSql(key, secret) {
  const rows = PERSONAS.map((p) => {
    const email = personaEmail(key, p);
    return `('${email}', '${demoPassword(secret, email)}')`;
  }).join(', ');
  return `update auth.users u
   set encrypted_password = extensions.crypt(p.password, extensions.gen_salt('bf', 10))
  from (values ${rows}) p (email, password)
 where u.email = p.email;
do $$
begin
  if exists (select from auth.users where email like '%+${key}${DOMAIN}' and encrypted_password is null) then
    raise exception 'an e2e household sign-in has no password';
  end if;
end $$;
`;
}

const TAG = '$e2e_household$';

/**
 * psql's input that runs `sql` as one query, in one round trip to the database (`\gexec` sends the
 * whole text at once, where psql would send each statement on its own: the seed's 45 or so, each a
 * round trip over the pooler). In one transaction, as a query of many statements is; on stdin, so the
 * derived passwords are never on a command line.
 */
export function oneTrip(sql) {
  if (sql.includes(TAG)) throw new Error(`the SQL holds ${TAG}`);
  return `select ${TAG}${sql}${TAG} \\gexec\n`;
}

if (/e2e-household\.mjs$/.test(process.argv[1] ?? '')) {
  const [what, key] = process.argv.slice(2);
  const seed = resolve(dirname(process.argv[1]), '../supabase/seed.sql');
  if (what === 'create') process.stdout.write(createSql(key, readFileSync(seed, 'utf8')));
  else if (what === 'remove') process.stdout.write(removeSql(key));
  else {
    console.error('usage: node scripts/e2e-household.mjs create|remove <key>');
    process.exit(2);
  }
}
