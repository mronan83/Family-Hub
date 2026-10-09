'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { parseClosure, parseSchoolYear, parseTerm, schoolSaveMessage } from '@/lib/school';
import { serverClient } from '@/lib/supabase/server';

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/school');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (form: FormData, key: string) => {
  const v = String(form.get(key) ?? '');
  return UUID.test(v) ? v : null;
};

function done(yearId: string | null, saved: string): never {
  revalidatePath('/admin/school');
  redirect(
    yearId
      ? `/admin/school/${yearId}?saved=${encodeURIComponent(saved)}`
      : `/admin/school?saved=${encodeURIComponent(saved)}`,
  );
}

/**
 * [SCH-01] Adds or edits a school year. Default years may not overlap (D-44); the database says so
 * if they do, and keeps a year's terms and days off inside its dates.
 */
export async function saveSchoolYear(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseSchoolYear(form);
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const row = {
    name: v.name,
    school_name: v.schoolName,
    start_date: v.startDate,
    end_date: v.endDate,
    is_default: v.isDefault,
  };
  const id = idOf(form, 'id');
  const { data, error } = id
    ? await db
        .from('school_year')
        .update(row)
        .eq('id', id)
        .eq('household_id', household.id)
        .select('id')
        .single()
    : await db
        .from('school_year')
        .insert({ ...row, household_id: household.id })
        .select('id')
        .single();
  if (error) {
    log('warn', 'school year not saved', { code: error.code, hint: error.hint });
    return { message: schoolSaveMessage(error) };
  }
  done(data.id as string, v.name);
}

/** [SCH-01] Archive (no longer applies; its history stays) or restore a school year. */
export async function setSchoolYearArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = idOf(form, 'id');
  const archive = form.get('archive') === 'true';
  const { error } = await db
    .from('school_year')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', id ?? '')
    .eq('household_id', household.id);
  if (error) log('warn', 'school year archive not saved', { code: error.code, hint: error.hint });
  revalidatePath('/admin/school');
  redirect(archive ? '/admin/school' : `/admin/school/${id}`);
}

/** [SCH-01] Adds a break or day off to a school year. */
export async function saveClosure(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const yearId = idOf(form, 'schoolYearId');
  const parsed = parseClosure(form);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.from('school_closure').insert({
    household_id: household.id,
    school_year_id: yearId,
    name: parsed.value.name,
    closure_type: parsed.value.closureType,
    start_date: parsed.value.startDate,
    end_date: parsed.value.endDate,
  });
  if (error) {
    log('warn', 'closure not saved', { code: error.code, hint: error.hint });
    return { message: schoolSaveMessage(error) };
  }
  done(yearId, parsed.value.name);
}

/** [SCH-01] Adds a term to a school year. */
export async function saveTerm(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const yearId = idOf(form, 'schoolYearId');
  const parsed = parseTerm(form);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.from('school_term').insert({
    household_id: household.id,
    school_year_id: yearId,
    name: parsed.value.name,
    start_date: parsed.value.startDate,
    end_date: parsed.value.endDate,
  });
  if (error) {
    log('warn', 'term not saved', { code: error.code, hint: error.hint });
    return { message: schoolSaveMessage(error) };
  }
  done(yearId, parsed.value.name);
}

/** [SCH-01] Removes a day off or a term (a mistake, or a snow day that didn't happen). */
export async function removeSchoolDate(form: FormData): Promise<void> {
  const { db, household } = await context();
  const yearId = idOf(form, 'schoolYearId');
  const table = form.get('kind') === 'term' ? 'school_term' : 'school_closure';
  const { error } = await db
    .from(table)
    .delete()
    .eq('id', idOf(form, 'id') ?? '')
    .eq('household_id', household.id);
  if (error) log('warn', 'school date not removed', { code: error.code });
  revalidatePath('/admin/school');
  redirect(`/admin/school/${yearId}`);
}

/**
 * [SCH-02] Who follows this school year instead of the default: adds and removes members'
 * profiles. A member can follow one school year on any date; the database refuses an overlap.
 */
export async function saveFollowers(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const yearId = idOf(form, 'schoolYearId');
  if (!yearId) return { message: 'That school year wasn’t found.' };
  const wanted = new Set(
    form
      .getAll('members')
      .map(String)
      .filter((v) => UUID.test(v)),
  );
  const { data: current, error: readError } = await db
    .from('member_school_profile')
    .select('id, member_id')
    .eq('school_year_id', yearId);
  if (readError) return { message: schoolSaveMessage(readError) };
  const have = new Map(
    (current as { id: string; member_id: string }[]).map((p) => [p.member_id, p.id]),
  );
  const remove = [...have].filter(([m]) => !wanted.has(m)).map(([, id]) => id);
  const add = [...wanted].filter((m) => !have.has(m));
  if (remove.length > 0) {
    const { error } = await db.from('member_school_profile').delete().in('id', remove);
    if (error) return { message: schoolSaveMessage(error) };
  }
  if (add.length > 0) {
    const { error } = await db
      .from('member_school_profile')
      .insert(
        add.map((m) => ({ household_id: household.id, member_id: m, school_year_id: yearId })),
      );
    if (error) {
      log('warn', 'school profiles not saved', { code: error.code, hint: error.hint });
      return { message: schoolSaveMessage(error) };
    }
  }
  done(yearId, 'who follows this school year');
}
