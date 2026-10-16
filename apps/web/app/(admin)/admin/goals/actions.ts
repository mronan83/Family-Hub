'use server';

import { ICON_NAMES } from '@familywise/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/auth/messages';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import {
  describeRule,
  type GoalFormValue,
  type GoalPayout,
  goalPayload,
  type GoalRead,
  goalRefusal,
  parseGoalForm,
  payoutWords,
  previewGoal,
  previewOutcome,
  type PreviewRead,
} from '@/lib/goals';
import { daysNeeded, periodWord } from '@/lib/goal-periods';
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

/** One rule's progress before and after, in the parent's words. */
export interface GoalPreviewRow {
  text: string;
  before: string | null;
  after: string;
  met: boolean;
}

/** [RWD-10] What the form's Preview shows: each rule now and after, and what saving would do. */
export interface GoalPreviewView {
  outcome: string;
  /** [RWD-16] "This week Homework home is due 4 days for Maya, so this week needs 4." */
  period?: string;
  before: string | null;
  after: string;
  rows: GoalPreviewRow[];
}

export interface GoalFormState extends FormState {
  preview?: GoalPreviewView;
}

/**
 * [RWD-16] What an "every day it's due" rule asks of the period going now: "This week Homework home
 * is due 4 days for Maya, so this week needs 4." Null for other rules and goals that don't repeat.
 */
function periodPreview(
  v: GoalFormValue,
  period: ReturnType<typeof previewGoal>['period'],
  names: { tags: Map<string, string>; items: Map<string, string> },
  family: boolean,
): string | null {
  const rule = v.rules.find((r) => r.type === 'DAYS_DUE');
  if (v.repeat === 'none' || !rule || !period || period.days_due === null) return null;
  const word = periodWord(v.repeat);
  const scope =
    'all' in rule.scope
      ? 'something it counts'
      : [
          ...(rule.scope.chore_ids ?? []).map((i) => names.items.get(i) ?? 'an item'),
          ...(rule.scope.tag_ids ?? []).map((t) => `${names.tags.get(t) ?? 'a tag'} items`),
        ].join(' or ');
  const due = period.days_due;
  const needed = daysNeeded({ daysDue: due, missesAllowed: period.misses_allowed });
  const who = family ? ' for the family' : '';
  return due === 0
    ? `This ${word} nothing it counts is due${who}, so this ${word} is neither won nor missed.`
    : `This ${word} ${scope} is due ${due} ${due === 1 ? 'day' : 'days'}${who}, so this ${word} needs ${needed}.`;
}

const progressWords = (r: { value: number; target: number; met: boolean }) =>
  `${r.value.toLocaleString('en-US')} of ${r.target.toLocaleString('en-US')}${r.met ? ', met' : ''}`;
const goalWords = (s: { pct: number; achieved: boolean }) =>
  s.achieved ? 'Reached' : `${Math.round(s.pct)}% there`;

/**
 * [RWD-10][US-406] The goal as the form has it, worked out from every check-off without saving
 * anything: each rule's progress now and after the change, and what saving would do (reach it and
 * pay, take it back and what it paid, end it). A goal not yet set shows where it would start.
 */
async function preview(
  db: Awaited<ReturnType<typeof serverClient>> & object,
  householdId: string,
  v: GoalFormValue,
): Promise<GoalFormState> {
  const read = await db.rpc('goal_preview_facts', {
    p_goal: {
      household_id: householdId,
      id: v.id,
      member_id: v.memberId,
      start_date: v.startDate,
      end_date: v.endDate,
      repeat: v.repeat,
    },
  });
  if (read.error) {
    log('warn', 'goal preview not read', { code: read.error.code, hint: read.error.hint });
    return { message: 'The preview couldn’t be worked out just now. Try again in a moment.' };
  }
  const facts = read.data as PreviewRead;
  let stored: GoalRead | null = null;
  let storedPayout: GoalPayout | null = null;
  if (facts.saved) {
    const [old, goal] = await Promise.all([
      db.rpc('goal_facts', { p_goal: v.id }),
      db.from('reward_goal').select('payout, achievement_count').eq('id', v.id).maybeSingle(),
    ]);
    if (old.error) {
      log('warn', 'goal preview not read', { code: old.error.code, hint: old.error.hint });
      return { message: 'The preview couldn’t be worked out just now. Try again in a moment.' };
    }
    stored = old.data as GoalRead;
    storedPayout = (goal.data?.payout as GoalPayout | undefined) ?? null;
  }
  const [{ data: tags }, { data: chores }, { data: prizes }] = await Promise.all([
    db.from('tag').select('id, name').eq('household_id', householdId),
    db.from('chore').select('id, title').eq('household_id', householdId),
    db.from('reward_catalog_item').select('id, title').eq('household_id', householdId),
  ]);
  const names = {
    tags: new Map((tags ?? []).map((t) => [t.id as string, t.name as string])),
    items: new Map((chores ?? []).map((c) => [c.id as string, c.title as string])),
  };
  const prize = (id: string) => prizes?.find((p) => p.id === id)?.title as string | undefined;
  const result = previewGoal(v, facts, stored);
  const family = v.memberId === null;
  // A rule's "now" is shown where the saved goal has the same rule in the same place.
  const same = (i: number) => {
    const old = stored?.rules[i];
    return (
      old !== undefined &&
      describeRule(old as Parameters<typeof describeRule>[0], names) ===
        describeRule(v.rules[i]!, names)
    );
  };
  const period = periodPreview(v, result.period, names, family);
  return {
    preview: {
      ...(period ? { period } : {}),
      outcome: previewOutcome(result, {
        saved: facts.saved,
        pays: payoutWords(v.payout, family, prize),
        paid: storedPayout ? payoutWords(storedPayout, family, prize) : null,
        paidItem: storedPayout?.type === 'catalog_item',
      }),
      before: result.before ? goalWords(result.before) : null,
      after: goalWords(result.after),
      rows: v.rules.map((r, i) => {
        const after = result.after.rules[i]!;
        const before = same(i) ? result.before?.rules[i] : undefined;
        return {
          text: describeRule(r, names),
          before: before ? progressWords(before) : null,
          after: progressWords(after),
          met: after.met,
        };
      }),
    },
  };
}

/**
 * [RWD-01][RWD-02][RWD-03][RWD-13] Sets a goal or changes one: its name, who it's for (a child who
 * earns rewards, or the whole family), its dates, its rules and how they combine, what reaching it
 * pays, an icon and optionally a photo (the shop's bucket and limits). "Preview" (intent=preview)
 * shows what the change would do instead of saving it (RWD-10). The form carries the goal's id, so sending it twice is one
 * goal. The database checks the rest (D-56) and logs what changed; new rules are recomputed.
 */
export async function saveGoal(_prev: GoalFormState, form: FormData): Promise<GoalFormState> {
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
  if (form.get('intent') === 'preview') return preview(db, household.id, parsed.value);
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

const ACTS = ['redeem', 'cancel', 'review', 'stop'] as const;
type Act = (typeof ACTS)[number];

/**
 * [RWD-09][RWD-06] A parent marks an achieved goal redeemed (the reward was given), cancels a goal
 * (it moves to history), clears a redeemed goal's review flag, or stops a repeating goal after the
 * period going now (RWD-15, D-123: back to its page, Stop or cancel open). Each is safe to send twice.
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
        : act === 'stop'
          ? await db.rpc('stop_goal_after_period', { p_goal: id })
          : await db.rpc('clear_goal_review', { p_goal: id });
  if (error) {
    log('warn', 'goal not changed', { code: error.code, hint: error.hint });
    redirect(`/admin/goals?error=${encodeURIComponent(error.hint || 'invalid')}`);
  }
  revalidatePath('/admin/goals');
  if (act === 'stop') redirect(`/admin/goals/${id}?did=stop#stop`);
  redirect(`/admin/goals?did=${act}&goal=${id}`);
}
