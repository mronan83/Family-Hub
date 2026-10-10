import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateHouseholdGoals } from '@/lib/goals';
import { log } from '@/lib/log';
import { loadChores, loadTags } from '../chores/data';
import { loadAdmins, loadMembers } from '../members/data';

/**
 * [RWD-04] Brings the household's goals up to date before a parent reads them (D-56): each goal that
 * needs it is evaluated now, as this parent, so the page is never behind and a preview (which runs no
 * jobs) shows it too. Returns a line to show when that couldn't be done; the page shows what was last
 * worked out.
 */
export async function bringGoalsUpToDate(
  db: SupabaseClient,
  householdId: string,
): Promise<string | null> {
  try {
    const stats = await evaluateHouseholdGoals(db, householdId, (goalId, e) =>
      log('warn', 'goal not evaluated', { goalId, error: String(e) }),
    );
    return stats.failed > 0
      ? 'Some progress couldn’t be brought up to date just now; this shows what was last worked out.'
      : null;
  } catch (e) {
    log('warn', 'goals not evaluated', { error: String(e) });
    return 'Progress couldn’t be brought up to date just now; this shows what was last worked out.';
  }
}

/** What the goal pages need besides the goals: who earns rewards, names for tags and items, parents. */
export async function loadGoalContext(db: SupabaseClient, householdId: string) {
  const [members, tags, chores, admins] = await Promise.all([
    loadMembers(db, householdId),
    loadTags(db, householdId),
    loadChores(db, householdId),
    loadAdmins(db, householdId),
  ]);
  const earners = members.filter((m) => m.earnsRewards && !m.archivedAt);
  const adminNames = new Map(
    admins.map((a) => [
      a.userId,
      members.find((m) => m.userId === a.userId)?.displayName ?? a.email,
    ]),
  );
  return {
    members,
    earners,
    tags: tags.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name })),
    items: chores
      .filter((c) => !c.archivedAt)
      .map((c) => ({ id: c.id, title: c.title }))
      .sort((a, b) => a.title.localeCompare(b.title)),
    names: {
      tags: new Map(tags.map((t) => [t.id, t.name])),
      items: new Map(chores.map((c) => [c.id, c.title])),
    },
    adminNames,
  };
}
