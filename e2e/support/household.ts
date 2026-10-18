import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import {
  createSql,
  householdId,
  oneTrip,
  ownId,
  passwordSql,
  personaEmail,
  removeSql,
} from '../../scripts/e2e-household.mjs';

// [NFR-14][D-110][D-136] Each spec's own made-up household (WP-110, scripts/e2e-household.mjs): a
// copy of the demo family under ids and sign-ins of its own, made afresh when the spec file starts.
// No spec sees another's rows, and none depends on run order or on the demo family being freshly
// loaded. The demo family itself is left to previews and auth.spec.ts.

export interface Household {
  /** The spec's file name without `.spec.ts`. */
  readonly key: string;
  /** Its household's id. */
  readonly id: string;
  /** Its copy of a seed id ('0de00000-…', supabase/seed.sql), or of a LIKE pattern over them. */
  own(seedId: string): string;
  /** Its copy of a demo sign-in's email: `alex+<key>@demo.familywise.invalid`. */
  email(persona: 'alex' | 'sam' | 'jordan' | 'riley'): string;
}

/** The household this worker made last (files run one after another, each making its own). */
let current: Household | null = null;

const specOf = (key: string) => `${key}.spec.ts`;

/** The running spec's own household, or null if it has none (auth.spec.ts uses the demo family). */
export function maybeCurrentHousehold(): Household | null {
  let file: string;
  try {
    file = path.basename(test.info().file);
  } catch {
    return null; // not in a test or a hook
  }
  return current && file === specOf(current.key) ? current : null;
}

/** The running spec's own household; throws if the spec has none (it calls ownHousehold()). */
export function currentHousehold(): Household {
  const household = maybeCurrentHousehold();
  if (!household) {
    throw new Error('this spec has no household of its own: call ownHousehold() at its top');
  }
  return household;
}

function run(db: string, script: string): void {
  execFileSync('psql', [db, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
    input: oneTrip(script),
    encoding: 'utf8',
    stdio: ['pipe', 'ignore', 'pipe'],
    timeout: 60_000,
  });
}

/**
 * [NFR-14][D-136] Gives the calling spec file its own household, called once at its top:
 * `const family = ownHousehold('chores')` in chores.spec.ts. Its ids are known at once
 * (`family.id`, `family.own(seedId)`); the household is made afresh, with its sign-ins' passwords,
 * in a beforeAll that runs before the spec's own. signIn() and the other helpers in e2e/support use it.
 *
 * It is taken away when the next file in this worker makes its own, not in an afterAll: Playwright
 * runs afterAll hooks in the order they are declared, so one declared here would run before the
 * spec's own clean-up. The last file's household, and that of a file whose worker stopped after a
 * failure, stay until the next run empties the test database (scripts/preview-db.sh).
 *
 * Measured on a local copy: about 1.5 s to make, sent as one query (oneTrip), so the pooler's
 * round trips add little; the hook's limit is the test's (90 s).
 */
export function ownHousehold(key: string): Household {
  const household: Household = {
    key,
    id: householdId(key),
    own: (seedId) => ownId(key, seedId),
    email: (persona) => personaEmail(key, persona),
  };
  test.beforeAll(() => {
    const file = path.basename(test.info().file);
    if (file !== specOf(key)) {
      throw new Error(`${file} names the household of ${key}.spec.ts; each spec has its own`);
    }
    const before = current;
    current = household;
    const db = process.env.SUPABASE_DB_URL;
    const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (!db || !secret) return;
    const away = before && before.key !== key ? removeSql(before.key) : '';
    const seed = readFileSync(path.resolve(__dirname, '../../supabase/seed.sql'), 'utf8');
    run(db, `${away}\n${createSql(key, seed)}\n${passwordSql(key, secret)}`);
  });
  return household;
}
