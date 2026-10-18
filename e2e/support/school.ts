import { sql } from './db';
import { currentHousehold } from './household';

// [NFR-14][D-110] School days a spec owns, whatever the date. The seed's school year, which each
// spec's household has, follows the real calendar (supabase/seed.sql), so from mid-June to late August, and over winter break,
// there is no school day near today. A spec that needs some gives the members it names a school
// year of their own, with every weekday from `from` to `to` a school day, and takes it away after.
// Members follow a year they are assigned to before the default (member_school_profile, WP-21).

/**
 * Makes every weekday from `from` to `to` ('YYYY-MM-DD') a school day for `members`, keeping each
 * member's lunch defaults. Returns the function that puts everything back; call it in a finally.
 */
export function withSchoolDays(
  db: string,
  members: string[],
  from: string,
  to: string,
): () => void {
  const name = `e2e school days ${Math.random().toString(36).slice(2, 8)}`;
  const year = sql(
    db,
    `insert into public.school_year (household_id, name, school_name, start_date, end_date, is_default)
     values ('${currentHousehold().id}', '${name}', 'Demo Elementary', '${from}'::date - 1, '${to}'::date + 1, false)
     returning id`,
  );
  sql(
    db,
    `insert into public.member_school_profile (household_id, member_id, school_year_id, lunch_defaults)
     select '${currentHousehold().id}', m.id, '${year}',
            coalesce((select p.lunch_defaults from public.member_school_profile p
                       where p.member_id = m.id
                         and p.school_year_id = public.member_school_year(m.id, '${from}'::date)), '{}'::jsonb)
       from public.member m
      where m.id = any (array[${members.map((m) => `'${m}'`).join(', ')}]::uuid[])`,
  );
  return () => {
    sql(db, `delete from public.school_year where id = '${year}'`);
  };
}
