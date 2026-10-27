// [RWD-21][D-146] The items a goal's Some items lists (WP-114): only those for who the goal is for
// that can still count, items that repeat first, then one-time items still to do; and every item the
// goal already counts, kept and flagged with why it isn't listed, so a goal never loses an item.
// Dates are household-local "YYYY-MM-DD" calendar dates.
import { dateWords, type IconName } from '@familywise/ui';
import type { Section } from './chore-sections';

/** Why a one-time item is over (WP-96's Completed), or archived. */
export type ItemOver = 'done' | 'missed' | 'skipped' | 'archived';

/** [NFR-16][D-128] An item a rule may count, with its picture and what decides whether it's listed. */
export interface GoalItem {
  id: string;
  title: string;
  icon?: IconName | null;
  /** A routine counts on its own day; a task on the day it's done, any day (D-31, D-52). */
  kind?: 'chore' | 'task';
  /** Who it's for (an item always has someone). */
  assignees?: string[];
  /** Repeats, or a one-time item's day. */
  repeats?: boolean;
  day?: string | null;
  /** Archived, or a one-time item done, missed or skipped; absent while it can still count. */
  over?: ItemOver | null;
}

/** The goal as the list reads it: who it's for, its dates, and today. */
export interface ItemsFor {
  /** The child it's for, or null for the whole family. */
  memberId: string | null;
  /** The children a family goal covers (who earn rewards), with names for the flags. */
  members: readonly { id: string; displayName: string }[];
  start: string;
  end: string | null;
  today: string;
}

export interface ItemChoice {
  item: GoalItem;
  /** A one-time item's day, as the app writes it: "Fri, Oct 30", "Overdue, Mon, Oct 26". */
  when?: string;
  /** Still counted only: why it isn't listed ("done", "not for Maya", "after the goal ends"). */
  flags?: string[];
}

export interface ItemGroups {
  repeats: ItemChoice[];
  once: ItemChoice[];
  /** Ticked (now or before) but not listed: still counted until unticked. */
  kept: ItemChoice[];
}

/** WP-96's section as the goal list's state: over when Completed or Archived. */
export function overFrom(
  section: Section,
  outcome?: 'done' | 'missed' | 'skipped',
): ItemOver | null {
  if (section === 'archived') return 'archived';
  if (section === 'completed') return outcome ?? 'done';
  return null;
}

/**
 * [NFR-16][D-128] A day as the app writes it, "Fri, Oct 30", with its year only when it isn't this
 * year's ("Tue, Jan 5, 2027"): the owner's choice on 27 October, over mm/dd/yyyy.
 */
export function shortDate(day: string, today: string): string {
  const words = dateWords(day);
  return day.slice(0, 4) === today.slice(0, 4) ? words.replace(/, \d{4}$/, '') : words;
}

/**
 * Why an item isn't listed for this goal, or none when it is: over (done, missed, skipped,
 * archived), not for the goal's person ("not for Leo"; "not for a child" for a family goal), or a
 * one-time chore whose day is outside the goal's dates. A task can be done any day and counts the day
 * it is done (D-31, D-52), so its day never keeps it off the list.
 */
export function itemFlags(item: GoalItem, goal: ItemsFor): string[] {
  const flags: string[] = [];
  if (item.over) flags.push(item.over);
  const people = item.assignees;
  if (!people) {
    // Not known (a made-up page's item): listed for anyone.
  } else if (goal.memberId) {
    if (!people.includes(goal.memberId)) {
      const name = goal.members.find((m) => m.id === goal.memberId)?.displayName;
      flags.push(name ? `not for ${name}` : 'not for this child');
    }
  } else if (!people.some((p) => goal.members.some((m) => m.id === p))) {
    flags.push('not for a child');
  }
  if (!item.repeats && item.day && item.kind !== 'task' && !item.over) {
    if (item.day < goal.start) flags.push('before it starts');
    else if (goal.end && item.day > goal.end) flags.push('after the goal ends');
  }
  return flags;
}

const when = (item: GoalItem, today: string) =>
  item.repeats || !item.day
    ? undefined
    : item.day < today
      ? `Overdue, ${shortDate(item.day, today)}`
      : shortDate(item.day, today);

/**
 * [RWD-21][D-146] The rule's Some items in three groups: Repeats (by name), Once, still to do (by
 * day, then name) and Still counted, the items in `kept` (ticked now or before) that aren't listed,
 * each with its flags. An item neither listed nor kept isn't shown.
 */
export function itemGroups(
  items: readonly GoalItem[],
  goal: ItemsFor,
  kept: readonly string[],
): ItemGroups {
  const groups: ItemGroups = { repeats: [], once: [], kept: [] };
  for (const item of items) {
    const flags = itemFlags(item, goal);
    const choice: ItemChoice = { item, when: when(item, goal.today) };
    if (flags.length > 0) {
      // Still counted shows why, not the day (the mockup).
      if (kept.includes(item.id)) groups.kept.push({ item, flags });
    } else if (item.repeats === false) groups.once.push(choice);
    else groups.repeats.push(choice);
  }
  const byName = (a: ItemChoice, b: ItemChoice) => a.item.title.localeCompare(b.item.title);
  groups.repeats.sort(byName);
  groups.once.sort((a, b) => (a.item.day ?? '').localeCompare(b.item.day ?? '') || byName(a, b));
  groups.kept.sort(byName);
  return groups;
}
