'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { log } from '@/lib/log';
import { parseGivePenalty, parsePaid, parseReason, penaltyMessage } from '@/lib/penalties';
import { parseRule, ruleArgs, ruleMessage } from '@/lib/penalty-rules';
import { serverClient } from '@/lib/supabase/server';
import { isoDay } from '@/lib/format';
import { loadMemberPenalties, loadPenaltyRules, loadPenaltySettings } from './data';

async function context(path: string) {
  const db = await serverClient();
  const user = await requireSignedIn(db, path);
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/** Where a form goes back to: an admin page of this app, never anywhere else. */
function backTo(form: FormData, fallback: string): string {
  const back = String(form.get('back') ?? '');
  return /^\/admin(\/[\w\-/]*)?$/.test(back) ? back : fallback;
}

async function nameOf(
  db: Awaited<ReturnType<typeof context>>['db'],
  householdId: string,
  memberId: string,
) {
  const { data } = await db
    .from('member')
    .select('display_name')
    .eq('id', memberId)
    .eq('household_id', householdId)
    .maybeSingle();
  return (data?.display_name as string | undefined) ?? 'They';
}

/**
 * [PTS-09][US-1111] Gives a penalty as the signed-in parent, from Home or a member's page. The form
 * carries a request id made when the page was drawn, so sending it twice gives it once; the database
 * checks who may, for whom, and that penalties are on (give_penalty).
 */
export async function givePenalty(_prev: FormState, form: FormData): Promise<FormState> {
  const back = backTo(form, '/admin');
  const { db, household } = await context(back);
  const { reasons } = await loadPenaltySettings(db, household.id);
  const parsed = parseGivePenalty(form, reasons);
  if (!parsed.ok) return { message: parsed.message };
  const p = parsed.value;
  const { error } = await db.rpc('give_penalty', {
    p_member_id: p.memberId,
    p_reason_id: p.reasonId,
    p_amount: p.amount,
    p_request_id: p.requestId,
  });
  if (error) {
    log('warn', 'penalty not given', { code: error.code, hint: error.hint });
    return { message: penaltyMessage(error, await nameOf(db, household.id, p.memberId)) };
  }
  revalidatePath('/admin', 'layout');
  redirect(`${back}?penalty=given&who=${p.memberId}#penalties`);
}

/** [PTS-09][US-1111] Records money paid outside FamilyWise against one penalty (record_penalty_paid). */
export async function recordPaid(_prev: FormState, form: FormData): Promise<FormState> {
  const back = backTo(form, '/admin/members');
  const { db, household } = await context(back);
  const memberId = String(form.get('memberId') ?? '');
  const { penalties } = await loadMemberPenalties(db, memberId);
  const owed = penalties.find((x) => x.id === String(form.get('penaltyId') ?? ''))?.owed ?? 0;
  const parsed = parsePaid(form, owed);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.rpc('record_penalty_paid', {
    p_penalty_id: parsed.value.penaltyId,
    p_amount: parsed.value.amount,
    p_request_id: parsed.value.requestId,
  });
  if (error) {
    log('warn', 'penalty payment not recorded', { code: error.code, hint: error.hint });
    return { message: penaltyMessage(error, await nameOf(db, household.id, memberId)) };
  }
  revalidatePath('/admin', 'layout');
  redirect(`${back}?penalty=paid#penalties`);
}

/** [PTS-09][D-156] Takes back a penalty given by mistake (take_back_penalty). */
export async function takeBackPenalty(form: FormData): Promise<void> {
  const back = backTo(form, '/admin/members');
  const { db } = await context(back);
  const { error } = await db.rpc('take_back_penalty', {
    p_penalty_id: String(form.get('penaltyId') ?? ''),
  });
  if (error) {
    log('warn', 'penalty not taken back', { code: error.code, hint: error.hint });
    redirect(`${back}?penalty=failed#penalties`);
  }
  revalidatePath('/admin', 'layout');
  redirect(`${back}?penalty=back#penalties`);
}

const SETTINGS = '/admin/settings/penalties';

/** [PTS-09] Turns the household's penalties on or off (set_penalties_on). */
export async function setPenaltiesOn(form: FormData): Promise<void> {
  const { db, household } = await context(SETTINGS);
  const on = form.get('on') === 'true';
  const { error } = await db.rpc('set_penalties_on', { p_household: household.id, p_on: on });
  if (error) {
    log('warn', 'penalties not switched', { code: error.code, hint: error.hint });
    redirect(`${SETTINGS}?done=failed`);
  }
  revalidatePath('/admin', 'layout');
  redirect(`${SETTINGS}?done=${on ? 'on' : 'off'}`);
}

/** [PTS-09] Adds a penalty reason to the household's list (add_penalty_reason). */
export async function addReason(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context(SETTINGS);
  const parsed = parseReason(form);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.rpc('add_penalty_reason', {
    p_household: household.id,
    p_name: parsed.value.name,
    p_unit: parsed.value.unit,
    p_amount: parsed.value.amount,
  });
  if (error) {
    log('warn', 'penalty reason not added', { code: error.code, hint: error.hint });
    return { message: penaltyMessage(error) };
  }
  revalidatePath(SETTINGS);
  redirect(`${SETTINGS}?done=added#reasons`);
}

/** [PTS-09] Removes a reason from the list; penalties given with it keep it (remove_penalty_reason). */
export async function removeReason(form: FormData): Promise<void> {
  const { db } = await context(SETTINGS);
  const { error } = await db.rpc('remove_penalty_reason', {
    p_reason: String(form.get('reasonId') ?? ''),
  });
  if (error) {
    log('warn', 'penalty reason not removed', { code: error.code, hint: error.hint });
    redirect(`${SETTINGS}?done=failed#reasons`);
  }
  revalidatePath(SETTINGS);
  redirect(`${SETTINGS}?done=removed#reasons`);
}

/**
 * [PTS-10][US-1112] Saves a penalty rule, new or changed (save_penalty_rule). The reason sets points or
 * money; a new rule starts today or later; a changed one may keep its start. The database checks who
 * may, for whom and what counts.
 */
export async function saveRule(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context(SETTINGS);
  const id = String(form.get('ruleId') ?? '');
  const [{ reasons }, rules] = await Promise.all([
    loadPenaltySettings(db, household.id),
    id ? loadPenaltyRules(db, household.id) : Promise.resolve([]),
  ]);
  const old = rules.find((r) => r.id === id);
  // A rule keeps its reason even once the reason is removed from the list.
  const own = old
    ? (
        await db
          .from('penalty_reason')
          .select('id, name, unit, amount')
          .eq('id', old.reasonId)
          .maybeSingle()
      ).data
    : null;
  const choices =
    own && !reasons.some((r) => r.id === own.id)
      ? [...reasons, own as (typeof reasons)[number]]
      : reasons;
  const parsed = parseRule(form, choices, isoDay(household.timezone), old?.startDate ?? null);
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.rpc('save_penalty_rule', {
    p_household: household.id,
    p_rule: ruleArgs(parsed.value),
  });
  if (error) {
    log('warn', 'penalty rule not saved', { code: error.code, hint: error.hint });
    return { message: ruleMessage(error) };
  }
  revalidatePath('/admin', 'layout');
  redirect(`${SETTINGS}?done=${parsed.value.id ? 'rule-saved' : 'rule-added'}#rules`);
}

/**
 * [PTS-10][US-1112] Records money paid outside FamilyWise against a rule's misses for one person,
 * spread over them oldest first (record_penalty_rule_paid).
 */
export async function recordRulePaid(_prev: FormState, form: FormData): Promise<FormState> {
  const back = backTo(form, '/admin/members');
  const { db, household } = await context(back);
  const memberId = String(form.get('memberId') ?? '');
  const ruleId = String(form.get('ruleId') ?? '');
  const rules = await loadPenaltyRules(db, household.id);
  const owed = rules.find((r) => r.id === ruleId)?.held[memberId] ?? 0;
  const parsed = parsePaid(form, owed, 'ruleId');
  if (!parsed.ok) return { message: parsed.message };
  const { error } = await db.rpc('record_penalty_rule_paid', {
    p_rule_id: ruleId,
    p_member_id: memberId,
    p_amount: parsed.value.amount,
    p_request_id: parsed.value.requestId,
  });
  if (error) {
    log('warn', 'penalty rule payment not recorded', { code: error.code, hint: error.hint });
    return { message: ruleMessage(error) };
  }
  revalidatePath('/admin', 'layout');
  redirect(`${back}?penalty=paid#penalties`);
}
