import type { Repeat } from '@familywise/rules-engine';
import { ICON_NAMES } from '@familywise/ui';
import { type GoalPreviewView, previewView } from '@/lib/goal-preview';
import type { GoalSummaries } from '@/lib/goal-summaries';
import {
  type GoalFormValue,
  type GoalPayout,
  type GoalRead,
  parseGoalForm,
  type PreviewRead,
} from '@/lib/goals';
import { log } from '@/lib/log';
import type { serverClient } from '@/lib/supabase/server';

// [RWD-10][NFR-16] What a goal form would do, worked out without saving: Preview (a server action,
// saveGoal) and the live summaries (POST /api/goals/summaries, a route so they never queue ahead of a
// save, WP-110) share it.

type Db = Awaited<ReturnType<typeof serverClient>> & object;

/** What Preview shows: the goal worked out, or why it couldn't be. */
export interface GoalFormPreview {
  message?: string;
  preview?: GoalPreviewView;
}

/**
 * [RWD-10][US-406] The goal as the form has it, worked out from every check-off without saving
 * anything (previewView): the facts goal_preview_facts gives for the form's dates and person, the
 * saved goal, and the names it needs.
 */
export async function previewGoal(
  db: Db,
  householdId: string,
  v: GoalFormValue,
): Promise<GoalFormPreview> {
  const read = await db.rpc('goal_preview_facts', {
    p_goal: {
      household_id: householdId,
      id: v.id,
      member_id: v.memberId,
      start_date: v.startDate,
      end_date: v.endDate,
      repeat: v.repeat,
      // [RWD-19] The rules, so the goals they count come with the facts.
      rules: v.rules,
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
  const [{ data: tags }, { data: chores }, { data: prizes }, { data: goals }, { data: people }] =
    await Promise.all([
      db.from('tag').select('id, name').eq('household_id', householdId),
      db.from('chore').select('id, title').eq('household_id', householdId),
      db.from('reward_catalog_item').select('id, title').eq('household_id', householdId),
      db.from('reward_goal').select('id, title, repeats').eq('household_id', householdId),
      db.from('member').select('id, display_name').eq('household_id', householdId),
    ]);
  return {
    preview: previewView(v, {
      facts,
      stored,
      storedPayout,
      tags: new Map((tags ?? []).map((t) => [t.id as string, t.name as string])),
      items: new Map((chores ?? []).map((c) => [c.id as string, c.title as string])),
      goals: new Map(
        (goals ?? []).map((g) => [
          g.id as string,
          { title: g.title as string, repeat: g.repeats as Repeat },
        ]),
      ),
      prizes: new Map((prizes ?? []).map((p) => [p.id as string, p.title as string])),
      people: new Map((people ?? []).map((m) => [m.id as string, m.display_name as string])),
    }),
  };
}

/** The form, read as saving reads it; a missing name doesn't stop the live summaries. */
export async function readGoalForm(
  db: Db,
  householdId: string,
  form: FormData,
): Promise<GoalFormValue | null> {
  const { data: members } = await db
    .from('member')
    .select('id')
    .eq('household_id', householdId)
    .eq('earns_rewards', true)
    .is('archived_at', null);
  if (!String(form.get('title') ?? '').trim()) form.set('title', 'Goal');
  const parsed = parseGoalForm(form, {
    icons: ICON_NAMES,
    memberIds: (members ?? []).map((m) => m.id as string),
  });
  return parsed.ok ? parsed.value : null;
}

/**
 * [NFR-16][D-128] The form's live summaries (WP-101): the form as it stands, worked out as Preview
 * works it out, without saving. A form that can't be read yet (no name, a rule half chosen) gives
 * none, and the form keeps showing nothing until it can.
 */
export async function liveSummaries(
  db: Db,
  householdId: string,
  form: FormData,
): Promise<GoalSummaries | null> {
  const value = await readGoalForm(db, householdId, form);
  if (!value) return null;
  const out = await previewGoal(db, householdId, value);
  return out.preview?.summaries ?? null;
}
