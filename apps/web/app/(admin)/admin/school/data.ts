import type { SupabaseClient } from '@supabase/supabase-js';
import type { DayType } from '@/lib/chores';
import type { ClosureType, Day } from '@/lib/school';

export interface SchoolYearRow {
  id: string;
  name: string;
  schoolName: string | null;
  startDate: string;
  endDate: string;
  isDefault: boolean;
  archivedAt: string | null;
}

export interface ClosureRow {
  id: string;
  name: string;
  closureType: ClosureType;
  startDate: string;
  endDate: string;
}

export interface TermRow {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
}

interface RawYear {
  id: string;
  name: string;
  school_name: string | null;
  start_date: string;
  end_date: string;
  is_default: boolean;
  archived_at: string | null;
}

const toYear = (r: RawYear): SchoolYearRow => ({
  id: r.id,
  name: r.name,
  schoolName: r.school_name,
  startDate: r.start_date,
  endDate: r.end_date,
  isDefault: r.is_default,
  archivedAt: r.archived_at,
});

/** [SCH-01] The household's school years, newest first. */
export async function loadYears(db: SupabaseClient, householdId: string): Promise<SchoolYearRow[]> {
  const { data, error } = await db
    .from('school_year')
    .select('id, name, school_name, start_date, end_date, is_default, archived_at')
    .eq('household_id', householdId)
    .order('start_date', { ascending: false });
  if (error) throw new Error(`school years: ${error.message}`);
  return (data as RawYear[]).map(toYear);
}

/** [SCH-01] One school year with its terms, closures, the members assigned to it, and every day. */
export async function loadYear(db: SupabaseClient, householdId: string, id: string) {
  const [year, terms, closures, profiles, days] = await Promise.all([
    db
      .from('school_year')
      .select('id, name, school_name, start_date, end_date, is_default, archived_at')
      .eq('household_id', householdId)
      .eq('id', id)
      .maybeSingle(),
    db
      .from('school_term')
      .select('id, name, start_date, end_date')
      .eq('school_year_id', id)
      .order('start_date'),
    db
      .from('school_closure')
      .select('id, name, closure_type, start_date, end_date')
      .eq('school_year_id', id)
      .order('start_date'),
    db.from('member_school_profile').select('member_id').eq('school_year_id', id),
    db.rpc('school_year_days', { p_school_year: id }),
  ]);
  for (const r of [year, terms, closures, profiles, days]) {
    if (r.error) throw new Error(`school year: ${r.error.message}`);
  }
  if (!year.data) return null;
  return {
    year: toYear(year.data as RawYear),
    terms: (terms.data as { id: string; name: string; start_date: string; end_date: string }[]).map(
      (t) => ({ id: t.id, name: t.name, startDate: t.start_date, endDate: t.end_date }),
    ),
    closures: (
      closures.data as {
        id: string;
        name: string;
        closure_type: ClosureType;
        start_date: string;
        end_date: string;
      }[]
    ).map((c) => ({
      id: c.id,
      name: c.name,
      closureType: c.closure_type,
      startDate: c.start_date,
      endDate: c.end_date,
    })),
    followers: (profiles.data as { member_id: string }[]).map((p) => p.member_id),
    days: (days.data as { day: string; day_type: DayType }[]).map((d): Day => ({
      day: d.day,
      dayType: d.day_type,
    })),
  };
}

/** [SCH-02] Each active member's day type on a date, with the school year they follow. */
export async function loadDayTypes(
  db: SupabaseClient,
  householdId: string,
  date: string,
): Promise<{ memberId: string; dayType: DayType; schoolYearId: string | null }[]> {
  const { data, error } = await db.rpc('household_day_types', {
    p_household_id: householdId,
    p_date: date,
  });
  if (error) throw new Error(`day types: ${error.message}`);
  return (data as { member_id: string; day_type: DayType; school_year_id: string | null }[]).map(
    (d) => ({ memberId: d.member_id, dayType: d.day_type, schoolYearId: d.school_year_id }),
  );
}
