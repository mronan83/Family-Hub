import type { Repeat } from '@familywise/rules-engine';
import { daysNeeded, periodWord } from './goal-periods';
import { type GoalSummaries, goalSummaries } from './goal-summaries';
import {
  describeRule,
  type GoalFormValue,
  type GoalPayout,
  type GoalRead,
  payoutWords,
  previewGoal,
  previewOutcome,
  type PreviewRead,
} from './goals';

// [RWD-10][US-406] The goal form's Preview, worked out from the facts without saving anything, and
// [NFR-16][D-128] the live summaries the form shows from the same result (WP-101). Pure: the server
// action reads the facts from the database; the /dev pages give made-up ones.

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
  /** [NFR-16][D-128] The summaries the form shows where the frames place them. */
  summaries?: GoalSummaries;
}

/** Everything Preview reads besides the form: the facts, the saved goal, and names. */
export interface PreviewInputs {
  facts: PreviewRead;
  stored: GoalRead | null;
  storedPayout: GoalPayout | null;
  tags: Map<string, string>;
  items: Map<string, string>;
  goals: Map<string, { title: string; repeat: Repeat }>;
  prizes: Map<string, string>;
  /** Children's names, by member id. */
  people: Map<string, string>;
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
 * [NFR-16-k] The form's live summaries come from the same result.
 */
export function previewView(v: GoalFormValue, inp: PreviewInputs): GoalPreviewView {
  const names = { tags: inp.tags, items: inp.items, goals: inp.goals };
  const result = previewGoal(v, inp.facts, inp.stored);
  const family = v.memberId === null;
  const prize = (id: string) => inp.prizes.get(id);
  // A rule's "now" is shown where the saved goal has the same rule in the same place.
  const same = (i: number) => {
    const old = inp.stored?.rules[i];
    return (
      old !== undefined &&
      describeRule(old as Parameters<typeof describeRule>[0], names) ===
        describeRule(v.rules[i]!, names)
    );
  };
  const period = periodPreview(v, result.period, names, family);
  return {
    ...(period ? { period } : {}),
    outcome: previewOutcome(result, {
      saved: inp.facts.saved,
      pays: payoutWords(v.payout, family, prize),
      paid: inp.storedPayout ? payoutWords(inp.storedPayout, family, prize) : null,
      paidItem: inp.storedPayout?.type === 'catalog_item',
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
    summaries: goalSummaries({
      v,
      read: inp.facts,
      result,
      tags: inp.tags,
      items: inp.items,
      people: inp.people,
      goals: inp.goals,
    }),
  };
}
