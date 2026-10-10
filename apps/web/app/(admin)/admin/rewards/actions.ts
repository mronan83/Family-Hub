'use server';

import { ENGINE_VERSION } from '@familywise/rules-engine';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { parseBonusRule, resumedFrom } from '@/lib/bonus';
import { isoDay } from '@/lib/format';
import { dayBefore, rebuildMemberHistory } from '@/lib/history';
import { log } from '@/lib/log';
import { checkPhoto, parseCatalog, refusal } from '@/lib/rewards';
import { serverClient } from '@/lib/supabase/server';
import { REWARD_ICONS } from './data';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/rewards');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/**
 * [PTS-03] Adds a reward or edits one: its name, cost, optional description, icon, stock, weekly limit,
 * whether it is offered, and optionally a new photo (JPEG, PNG or WebP up to 2 MB, in the household's
 * own folder of the private `rewards` bucket). A replaced photo is removed.
 */
export async function saveReward(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseCatalog(form, REWARD_ICONS);
  if (!parsed.ok) return { message: parsed.message };
  const photo = checkPhoto(form.get('photo'));
  if (typeof photo === 'string') return { message: photo };
  const given = String(form.get('id') ?? '');
  if (given && !GUID.test(given)) return { message: 'That reward isn’t there any more.' };
  const id = given || crypto.randomUUID();

  let previous: string | null = null;
  if (given) {
    const { data } = await db
      .from('reward_catalog_item')
      .select('image_path')
      .eq('id', id)
      .eq('household_id', household.id)
      .maybeSingle();
    if (!data) return { message: 'That reward isn’t there any more.' };
    previous = data.image_path;
  }

  let imagePath: string | null = null;
  if (photo) {
    const file = form.get('photo') as File;
    imagePath = `${household.id}/${id}/${crypto.randomUUID()}.${photo.ext}`;
    const { error } = await db.storage
      .from('rewards')
      .upload(imagePath, file, { contentType: file.type, upsert: false });
    if (error) {
      log('warn', 'reward photo not uploaded', { message: error.message });
      return { message: 'That photo didn’t upload. Try again in a moment.' };
    }
  }

  const v = parsed.value;
  const row = {
    title: v.title,
    description: v.description,
    icon: v.icon,
    cost_points: v.costPoints,
    stock: v.stock,
    weekly_limit: v.weeklyLimit,
    active: v.active,
    ...(imagePath ? { image_path: imagePath } : {}),
  };
  const { error } = given
    ? await db.from('reward_catalog_item').update(row).eq('id', id).eq('household_id', household.id)
    : await db.from('reward_catalog_item').insert({ id, household_id: household.id, ...row });
  if (error) {
    log('warn', 'reward not saved', { code: error.code });
    if (imagePath) await db.storage.from('rewards').remove([imagePath]);
    return { message: 'That didn’t save. Try again in a moment.' };
  }
  if (imagePath && previous) await db.storage.from('rewards').remove([previous]);
  revalidatePath('/admin/rewards');
  redirect(`/admin/rewards?saved=${encodeURIComponent(v.title)}`);
}

/** [PTS-03] Takes a reward's photo away; it shows its icon again. */
export async function removePhoto(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  if (!GUID.test(id)) redirect('/admin/rewards');
  const { data } = await db
    .from('reward_catalog_item')
    .select('image_path')
    .eq('id', id)
    .eq('household_id', household.id)
    .maybeSingle();
  if (data?.image_path) {
    const { error } = await db.storage.from('rewards').remove([data.image_path]);
    if (error) log('warn', 'reward photo not removed', { message: error.message });
    await db.from('reward_catalog_item').update({ image_path: null }).eq('id', id);
  }
  revalidatePath('/admin/rewards');
  redirect(`/admin/rewards/${id}?photo=removed`);
}

/** [PTS-03] Archive (off the shop, past requests keep their cost) or put back; never deleted. */
export async function setRewardArchived(form: FormData): Promise<void> {
  const { db, household } = await context();
  const archive = form.get('archive') === 'true';
  const { error } = await db
    .from('reward_catalog_item')
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq('id', String(form.get('id') ?? ''))
    .eq('household_id', household.id);
  if (error) log('warn', 'reward archive not saved', { code: error.code });
  revalidatePath('/admin/rewards');
  redirect(archive ? '/admin/rewards?archived=1' : '/admin/rewards');
}

const ACTS = ['approve', 'deny', 'fulfil', 'cancel'] as const;
type Act = (typeof ACTS)[number];

/**
 * [PTS-04][US-1105] A parent approves (the spend is posted), says not this time, marks a reward
 * given, or cancels one (refunding an approved one). Each is safe to send twice.
 */
export async function redemptionAction(form: FormData): Promise<void> {
  const { db } = await context();
  const [act, id] = String(form.get('act') ?? '').split(':') as [Act, string];
  if (!ACTS.includes(act) || !id || !GUID.test(id)) redirect('/admin/rewards?error=invalid');
  const note =
    String(form.get(`note:${id}`) ?? '')
      .trim()
      .slice(0, 200) || null;
  const { error } =
    act === 'approve' || act === 'deny'
      ? await db.rpc('decide_redemption', { p_id: id, p_decision: act, p_note: note })
      : act === 'fulfil'
        ? await db.rpc('fulfil_redemption', { p_id: id })
        : await db.rpc('cancel_redemption', { p_id: id });
  if (error) {
    log('warn', 'redemption not changed', { code: error.code, hint: error.hint });
    redirect(`/admin/rewards?error=${refusal(error).reason}`);
  }
  revalidatePath('/admin/rewards');
  redirect(`/admin/rewards?did=${act}&request=${id}`);
}

/**
 * [PTS-05][US-1107] Adds a bonus rule: points for a run of good days, or for each day with everything
 * done, counting from a date. A rule's terms don't change once set (each bonus names the rule that
 * paid it): to change one, archive it and add another.
 */
export async function saveBonusRule(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const parsed = parseBonusRule(form, isoDay(household.timezone));
  if (!parsed.ok) return { message: parsed.message };
  const v = parsed.value;
  const { error } = await db.from('points_rule').insert({
    household_id: household.id,
    rule_type: v.ruleType,
    streak_days: v.streakDays,
    bonus_points: v.bonusPoints,
    counts_from: v.countsFrom,
  });
  if (error) {
    log('warn', 'bonus rule not saved', { code: error.code });
    return { message: 'That didn’t save. Try again in a moment.' };
  }
  revalidatePath('/admin/rewards');
  redirect('/admin/rewards?bonus=added#bonus-heading');
}

const BONUS_ACTS = ['off', 'on', 'archive'] as const;
type BonusAct = (typeof BONUS_ACTS)[number];

/**
 * [PTS-05] Turns a bonus rule off or back on, or archives it; never deleted, and bonuses it paid stay.
 * Back on, it counts from today: days while it was off never pay.
 */
export async function bonusRuleAction(form: FormData): Promise<void> {
  const { db, household } = await context();
  const [act, id] = String(form.get('act') ?? '').split(':') as [BonusAct, string];
  if (!BONUS_ACTS.includes(act) || !id || !GUID.test(id)) redirect('/admin/rewards?error=invalid');
  const { data: rule } = await db
    .from('points_rule')
    .select('counts_from')
    .eq('id', id)
    .eq('household_id', household.id)
    .is('archived_at', null)
    .maybeSingle();
  if (!rule) redirect('/admin/rewards?error=bonus_gone#bonus-heading');
  const change =
    act === 'archive'
      ? { archived_at: new Date().toISOString(), active: false }
      : act === 'off'
        ? { active: false }
        : {
            active: true,
            counts_from: resumedFrom(rule.counts_from as string, isoDay(household.timezone)),
          };
  const { error } = await db
    .from('points_rule')
    .update(change)
    .eq('id', id)
    .eq('household_id', household.id);
  if (error) {
    log('warn', 'bonus rule not changed', { code: error.code });
    redirect('/admin/rewards?error=invalid#bonus-heading');
  }
  revalidatePath('/admin/rewards');
  redirect(`/admin/rewards?bonus=${act}#bonus-heading`);
}

/**
 * [PTS-05] Applies the bonus rules now to the days already over, as day close does each night: each
 * child's history is brought up to date first (RWD-11), and a bonus already paid is never paid again.
 */
export async function applyBonusesNow(): Promise<void> {
  const { db, household } = await context();
  const { data: earners, error: mError } = await db
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .eq('earns_rewards', true)
    .is('archived_at', null);
  if (mError) throw new Error(`members: ${mError.message}`);
  const through = dayBefore(isoDay(household.timezone));
  try {
    for (const { id } of earners as { id: string }[]) {
      const { data: stale } = await db.rpc('member_history_stale', {
        p_member: id,
        p_engine_version: ENGINE_VERSION,
      });
      if (stale) await rebuildMemberHistory(db, id, through);
    }
  } catch (e) {
    log('warn', 'history not rebuilt', { error: String(e) });
    redirect('/admin/rewards?error=history#bonus-heading');
  }
  const { data, error } = await db.rpc('apply_points_rules', { p_household: household.id });
  if (error) {
    log('warn', 'bonus rules not applied', { code: error.code });
    redirect('/admin/rewards?error=invalid#bonus-heading');
  }
  revalidatePath('/admin/rewards');
  redirect(`/admin/rewards?bonus=paid&posted=${(data as { posted: number }).posted}#bonus-heading`);
}
