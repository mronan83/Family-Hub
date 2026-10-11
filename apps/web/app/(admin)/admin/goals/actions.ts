'use server';

import { ICON_NAMES } from '@familywise/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { goalPayload, goalRefusal, parseGoalForm } from '@/lib/goals';
import { log } from '@/lib/log';
import { checkPhoto } from '@/lib/rewards';
import { serverClient } from '@/lib/supabase/server';

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function context() {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/goals');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  return { db: db!, household };
}

/**
 * [RWD-01][RWD-02][RWD-03] Sets a goal or changes one: its name, who it's for (a child who earns
 * rewards, or the whole family), its dates, its rules and how they combine, an icon and optionally a
 * photo (the shop's bucket and limits). The form carries the goal's id, so sending it twice is one
 * goal. The database checks the rest (D-56) and logs what changed; new rules are recomputed.
 */
export async function saveGoal(_prev: FormState, form: FormData): Promise<FormState> {
  const { db, household } = await context();
  const { data: members } = await db
    .from('member')
    .select('id')
    .eq('household_id', household.id)
    .eq('earns_rewards', true)
    .is('archived_at', null);
  const parsed = parseGoalForm(form, {
    icons: ICON_NAMES,
    memberIds: (members ?? []).map((m) => m.id as string),
  });
  if (!parsed.ok) return { message: parsed.message };
  const photo = checkPhoto(form.get('photo'));
  if (typeof photo === 'string') return { message: photo };
  const v = parsed.value;

  const { data: existing } = await db
    .from('reward_goal')
    .select('image_path')
    .eq('id', v.id)
    .eq('household_id', household.id)
    .maybeSingle();
  let imagePath: string | undefined;
  if (photo) {
    const file = form.get('photo') as File;
    imagePath = `${household.id}/${v.id}/${crypto.randomUUID()}.${photo.ext}`;
    const { error } = await db.storage
      .from('rewards')
      .upload(imagePath, file, { contentType: file.type, upsert: false });
    if (error) {
      log('warn', 'goal photo not uploaded', { message: error.message });
      return { message: 'That photo didn’t upload. Try again in a moment.' };
    }
  }

  const { error } = await db.rpc('save_goal', {
    p_goal: goalPayload(v, household.id, imagePath),
  });
  if (error) {
    log('warn', 'goal not saved', { code: error.code, hint: error.hint });
    if (imagePath) await db.storage.from('rewards').remove([imagePath]);
    return { message: goalRefusal(error) };
  }
  if (imagePath && existing?.image_path) {
    await db.storage.from('rewards').remove([existing.image_path]);
  }
  revalidatePath('/admin/goals');
  redirect(`/admin/goals?saved=${encodeURIComponent(v.title)}`);
}

/** [RWD-01] Takes a goal's photo away; its icon shows again. */
export async function removeGoalPhoto(form: FormData): Promise<void> {
  const { db, household } = await context();
  const id = String(form.get('id') ?? '');
  if (!GUID.test(id)) redirect('/admin/goals');
  const { data: goal } = await db
    .from('reward_goal')
    .select(
      'id, member_id, title, description, icon, image_path, start_date, end_date, rule_logic, reward_rule (rule_type, target, scope, params, sort_order)',
    )
    .eq('id', id)
    .eq('household_id', household.id)
    .maybeSingle();
  if (goal?.image_path) {
    const rules = (
      goal.reward_rule as {
        rule_type: string;
        target: number;
        scope: unknown;
        params: unknown;
        sort_order: number;
      }[]
    )
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((r) => ({ type: r.rule_type, target: r.target, scope: r.scope, params: r.params }));
    const { error } = await db.rpc('save_goal', {
      p_goal: {
        id: goal.id,
        household_id: household.id,
        member_id: goal.member_id,
        title: goal.title,
        description: goal.description,
        icon: goal.icon,
        start_date: goal.start_date,
        end_date: goal.end_date,
        rule_logic: goal.rule_logic,
        rules,
        image_path: null,
      },
    });
    if (error) log('warn', 'goal photo not cleared', { code: error.code, hint: error.hint });
    else await db.storage.from('rewards').remove([goal.image_path as string]);
  }
  revalidatePath('/admin/goals');
  redirect(`/admin/goals/${id}?photo=removed`);
}

const ACTS = ['redeem', 'cancel', 'review'] as const;
type Act = (typeof ACTS)[number];

/**
 * [RWD-09][RWD-06] A parent marks an achieved goal redeemed (the reward was given), cancels a goal
 * (it moves to history), or clears a redeemed goal's review flag. Each is safe to send twice.
 */
export async function goalAction(form: FormData): Promise<void> {
  const { db } = await context();
  const [act, id] = String(form.get('act') ?? '').split(':') as [Act, string];
  if (!ACTS.includes(act) || !id || !GUID.test(id)) redirect('/admin/goals?error=invalid');
  const { error } =
    act === 'redeem'
      ? await db.rpc('redeem_goal', { p_goal: id })
      : act === 'cancel'
        ? await db.rpc('cancel_goal', { p_goal: id })
        : await db.rpc('clear_goal_review', { p_goal: id });
  if (error) {
    log('warn', 'goal not changed', { code: error.code, hint: error.hint });
    redirect(`/admin/goals?error=${encodeURIComponent(error.hint || 'invalid')}`);
  }
  revalidatePath('/admin/goals');
  redirect(`/admin/goals?did=${act}&goal=${id}`);
}
