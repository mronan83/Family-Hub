import type { Repeat, RuleType } from '@familywise/rules-engine';
import { andList } from './format';
import { daysNeeded, monthDay, periodWord, weekday } from './goal-periods';
import { clockWords } from './goal-steps';
import {
  type GoalFormValue,
  type GoalPreviewResult,
  type PreviewClosure,
  type PreviewRead,
  RULE_WORDS,
} from './goals';
import { dateWords } from '@familywise/ui';

// [NFR-16][D-128] The goal form's words as the approved mockups write them (WP-101): each rule as one
// summary line, and the live summaries the frames place on the form (the rule's days due, every
// child's, the steps, the weights, the weeks a weeks-won rule counts). The summaries are worked out
// from Preview's own result (previewGoal), never by a second engine.

/** A piece of a summary line: words, or an item's name with its picture. */
export type SummaryPart = string | { icon: string | null; text: string };

/** What a summary line needs to know about a rule, as the form holds it. */
export interface SummaryRule {
  type: RuleType;
  target: number;
  scope: 'all' | 'tags' | 'items';
  tagIds: string[];
  itemIds: string[];
  grace: number;
  misses?: number;
  onTime?: string | null;
  source?: string | null;
  inARow?: boolean;
}

export interface SummaryNames {
  tags: readonly { id: string; name: string }[];
  items: readonly { id: string; title: string; icon?: string | null }[];
  goals?: readonly { id: string; title: string; repeat: Exclude<Repeat, 'none'> }[];
}

/** "Some items: Homework home" · "Some tags: Morning or Kitchen" · "Everything", with pictures. */
export function scopeParts(r: SummaryRule, names: SummaryNames): SummaryPart[] {
  if (r.scope === 'items') {
    const items = names.items.filter((i) => r.itemIds.includes(i.id));
    if (items.length === 0) return ['Some items: none chosen'];
    return [
      'Some items:',
      ...joinParts(items.map((i) => ({ icon: i.icon ?? null, text: i.title }))),
    ];
  }
  if (r.scope === 'tags') {
    const tags = names.tags.filter((t) => r.tagIds.includes(t.id)).map((t) => t.name);
    return [tags.length ? `Some tags: ${orWords(tags)}` : 'Some tags: none chosen'];
  }
  return ['Everything'];
}

/**
 * [NFR-16-i] A rule in one line, as the WP-81 addendum draws it: "Every day it's due: Homework home,
 * by 6:00 pm" · "Things done: 5 · Reading" · "Weeks won of a repeating goal: 3 in a row · Homework".
 */
export function ruleSummaryParts(r: SummaryRule, names: SummaryNames): SummaryPart[] {
  const label = RULE_WORDS[r.type].label;
  if (r.type === 'PERIODS_WON') {
    const source = names.goals?.find((g) => g.id === r.source) ?? names.goals?.[0];
    return [
      `${label}: ${r.target.toLocaleString('en-US')}${r.inARow ? ' in a row' : ' in total'} ·`,
      source?.title ?? 'no goal chosen',
    ];
  }
  const scope: SummaryPart[] =
    r.scope === 'items'
      ? scopeParts(r, names).slice(1)
      : r.scope === 'tags'
        ? [
            `${orWords(names.tags.filter((t) => r.tagIds.includes(t.id)).map((t) => t.name)) || 'no tag chosen'} items`,
          ]
        : ['everything'];
  if (scope.length === 0) scope.push('no item chosen');
  const head =
    r.type === 'DAYS_DUE' ? `${label}:` : `${label}: ${r.target.toLocaleString('en-US')} ·`;
  const tail: string[] = [];
  if (r.type === 'DAYS_DUE' && r.misses)
    tail.push(`${r.misses} miss${r.misses > 1 ? 'es' : ''} allowed`);
  if (r.type === 'STREAK')
    tail.push(r.grace === 0 ? 'no misses forgiven' : `${r.grace} forgiven a week`);
  if (r.onTime === 'due_time') tail.push('by each chore’s due time');
  else if (r.onTime) tail.push(`by ${clockWords(r.onTime)}`);
  const parts: SummaryPart[] = [head, ...scope];
  if (tail.length) appendWords(parts, `, ${tail.join(', ')}`);
  return parts;
}

/** The summary line as words alone, as a screen reader hears it. */
export function partsText(parts: readonly SummaryPart[]): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : p.text))
    .join(' ')
    .replace(/ ,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * [NFR-16-j] Something a rule needs before it can save, in the parent's words; null when it can. A
 * rule with something to fix stays open (D-128).
 */
export function ruleProblem(
  r: SummaryRule & { weight?: number | null },
  weighted: boolean,
): string | null {
  if (r.type !== 'PERIODS_WON' && r.scope === 'items' && r.itemIds.length === 0)
    return 'Choose an item it counts.';
  if (r.type !== 'PERIODS_WON' && r.scope === 'tags' && r.tagIds.length === 0)
    return 'Choose a tag it counts.';
  if (
    r.type !== 'DAYS_DUE' &&
    !(Number.isInteger(r.target) && r.target >= 1 && r.target <= 100_000)
  )
    return 'Give it a target from 1 to 100,000.';
  if (weighted && !(Number.isInteger(r.weight) && r.weight! >= 1 && r.weight! <= 100))
    return 'Give it a weight from 1 to 100.';
  return null;
}

// ---------------------------------------------------------------------------------------------
// [NFR-16-k] The live summaries
// ---------------------------------------------------------------------------------------------

/** Where each summary shows on the form, as the frames place them. */
export interface GoalSummaries {
  /** Under each rule (by its place): its days due this period, or the weeks it counts. */
  rules: (string | null)[];
  /** Under the steps: what each step of this period pays. */
  steps: string | null;
  /** Under the weights: the weighted sum so far and what the period would pay. */
  weights: string | null;
}

export interface SummaryContext {
  /** The form's goal, parsed. */
  v: GoalFormValue;
  read: PreviewRead;
  result: GoalPreviewResult;
  tags: Map<string, string>;
  items: Map<string, string>;
  /** Children's names, by member id. */
  people: Map<string, string>;
  goals: Map<string, { title: string; repeat: Repeat }>;
}

/** "Friday, Oct 16 is a teacher planning day" for a closure, as the frame says it. */
export function closureWords(c: PreviewClosure): string {
  const when = `${weekday(c.date)}, ${monthDay(c.date)}`;
  const name = c.name.trim();
  if (c.kind === 'break') return `${when} is in ${name}`;
  if (c.kind === 'teacher_day' || c.kind === 'snow_day') {
    const lower = name.charAt(0).toLowerCase() + name.slice(1);
    return `${when} is ${/^(a|an|the) /i.test(name) ? lower : `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${lower}`}`;
  }
  return `${when} is ${name}`;
}

/** The weekdays of a period with nothing due because the school was closed, each once by date. */
function closuresIn(
  closures: readonly PreviewClosure[],
  days: readonly { date: string; mark: string }[] | null,
  who: readonly (string | null)[],
): PreviewClosure[] {
  const seen = new Set<string>();
  const out: PreviewClosure[] = [];
  for (const d of days ?? []) {
    if (d.mark !== 'none') continue;
    const c = closures.find((x) => x.date === d.date && who.includes(x.member_id ?? null));
    if (c && !seen.has(c.date)) {
      seen.add(c.date);
      out.push(c);
    }
  }
  return out;
}

/**
 * [D-128] How many closed days one of a rule's items would have been due on were the school open;
 * null when a closure doesn't say which routines would have been due.
 */
export function wouldBeDue(
  closures: readonly PreviewClosure[],
  scope: GoalFormValue['rules'][number]['scope'],
): number | null {
  if (closures.some((c) => !c.due)) return null;
  const counts = (d: { chore_id: string; tag_ids: string[] }) =>
    'all' in scope ||
    (scope.chore_ids ?? []).includes(d.chore_id) ||
    d.tag_ids.some((t) => (scope.tag_ids ?? []).includes(t));
  return closures.filter((c) => c.due!.some(counts)).length;
}

/** What a DAYS_DUE rule counts, in a sentence: "Homework home", "Morning items", "something it counts". */
function scopeWords(r: GoalFormValue['rules'][number], ctx: SummaryContext): string {
  if ('all' in r.scope) return 'something it counts';
  const words = [
    ...(r.scope.chore_ids ?? []).map((i) => ctx.items.get(i) ?? 'an item'),
    ...(r.scope.tag_ids ?? []).map((t) => `${ctx.tags.get(t) ?? 'a tag'} items`),
  ];
  return orWords(words);
}

/** A short name for a rule in the weights' sum: its items or tags, or what it counts. */
function shortRule(r: GoalFormValue['rules'][number], ctx: SummaryContext): string {
  if (r.type === 'PERIODS_WON') return RULE_WORDS.PERIODS_WON.unit(2);
  if ('all' in r.scope) return RULE_WORDS[r.type].unit(2);
  return scopeWords(r, ctx);
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const points = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'point' : 'points'}`;

/**
 * [NFR-16-k][D-128] The live summaries from Preview's result: the period going now as the form would
 * have it (its days due, each child's, its step), the rules' progress and the goals counted.
 */
export function goalSummaries(ctx: SummaryContext): GoalSummaries {
  const { v, read, result } = ctx;
  const period = result.period;
  const word = v.repeat === 'none' ? null : periodWord(v.repeat);
  const steps = v.payout.type === 'points' ? (v.payout.steps ?? []) : [];
  const out: GoalSummaries = { rules: v.rules.map(() => null), steps: null, weights: null };
  const closures = read.closures ?? [];
  const owner = v.memberId;

  // The rule's days due this period, for the goal's person, or for each child.
  const daysRule = v.rules.findIndex((r) => r.type === 'DAYS_DUE');
  if (daysRule >= 0 && word && period) {
    const r = v.rules[daysRule]!;
    const what = scopeWords(r, ctx);
    const misses = Number(r.params.misses_allowed ?? 0);
    if (period.children) {
      const kids = period.children;
      const off = closuresIn(
        closures,
        kids.flatMap((k) => k.days ?? []),
        [...kids.map((k) => k.member_id), null],
      );
      const due = kids
        .filter((k) => k.contributes && (k.days_due ?? 0) > 0)
        .map((k) => `${days(k.days_due!)} for ${ctx.people.get(k.member_id) ?? 'a child'}`);
      const free = kids
        .filter((k) => !k.contributes || !k.days_due)
        .map((k) => ctx.people.get(k.member_id) ?? 'a child');
      const needs = [
        ...new Set(
          kids
            .filter((k) => k.contributes && k.days_due)
            .map((k) => daysNeeded({ daysDue: k.days_due, missesAllowed: misses })),
        ),
      ];
      const why = off.length ? ` (${andList(off.map(closureWords))})` : '';
      out.rules[daysRule] =
        due.length === 0
          ? `This ${word} ${what} is due for no child${why}, so this ${word} is neither won nor missed.`
          : `This ${word} ${what} is due ${andList(due)}${why}: ${
              needs.length === 1
                ? `each needs ${needs[0]}`
                : andList(
                    kids
                      .filter((k) => k.contributes && k.days_due)
                      .map(
                        (k) =>
                          `${ctx.people.get(k.member_id) ?? 'a child'} needs ${daysNeeded({ daysDue: k.days_due, missesAllowed: misses })}`,
                      ),
                  )
            }.${free.length ? ` ${andList(free)} ${free.length === 1 ? 'has' : 'have'} nothing due, so ${free.length === 1 ? 'doesn’t' : 'don’t'} hold it back.` : ''}`;
    } else if (period.days_due !== null) {
      const due = period.days_due;
      const off = closuresIn(closures, period.days, [owner, null]);
      const who = owner ? ctx.people.get(owner) : null;
      const forWho = who ? ` for ${who}` : owner === null ? ' for the family' : '';
      const why = off.length ? ` (${andList(off.map(closureWords))})` : '';
      const needed = daysNeeded({ daysDue: due, missesAllowed: period.misses_allowed });
      // [D-128] A normal week counts only the closed days one of the rule's items would have been
      // due; when that isn't known, the sentence isn't said.
      const missed = wouldBeDue(off, r.scope);
      const usual =
        missed === null
          ? needed
          : daysNeeded({ daysDue: due + missed, missesAllowed: period.misses_allowed });
      const line =
        due === 0
          ? `This ${word} nothing it counts is due${forWho}${why}, so this ${word} is neither won nor missed.`
          : `This ${word} ${what} is due ${days(due)}${forWho}${why}`;
      const missSteps = steps.filter((s) => s.misses !== undefined && s.misses !== null);
      if (due > 0 && missSteps.length) {
        // [RWD-18] Steps by days missed: what each step of this period pays.
        const onTime = r.params.on_time ? ' on time' : '';
        const pays = [
          `all ${due}${onTime} pays ${v.payout.type === 'points' ? v.payout.amount : 0}`,
          ...missSteps
            .filter((s) => due - s.misses! >= 1)
            .map((s) => `${due - s.misses!} pays ${s.amount}`),
        ];
        out.steps = `${line}: ${pays.join(', ')}.`;
      } else if (due > 0) {
        out.rules[daysRule] = `${line}, so this ${word} needs ${needed}.${
          usual !== needed ? ` A normal ${word} needs ${usual}.` : ''
        }`;
      } else {
        out.rules[daysRule] = line;
      }
    }
  }

  // [RWD-19][D-126] A rule counting another goal's periods: the ones that start on or after its start.
  v.rules.forEach((r, i) => {
    if (r.type !== 'PERIODS_WON') return;
    const id = r.params.goal_id;
    const source = id ? ctx.goals.get(id) : undefined;
    if (!source || source.repeat === 'none') return;
    const unit = periodWord(source.repeat);
    const first = firstCounted(
      source.repeat,
      v.startDate,
      read.week_start,
      (id && read.sources?.[id]) || [],
    );
    const so = first
      ? `, so the first that counts is the ${unit} of ${dateWords(first)}`
      : ', so the next one is the first that counts';
    // The help line above it says how a run is kept; the summary says which period comes first.
    out.rules[i] =
      `A ${unit} counts when it starts on or after this goal’s start, ${dateWords(v.startDate)}${so}.`;
  });

  // [RWD-18] Weights: each rule's % (up to 100) times its weight, added up, and what it would pay.
  const weighted = steps.length > 0 && v.rules.length > 1 && v.rules.every((r) => r.weight);
  if (weighted) {
    const rules = result.after.rules;
    const terms = v.rules.map((r, i) => {
      const p = rules[i];
      const pct = Math.min(100, Math.round(p?.pct ?? 0));
      const unit = r.type === 'DAYS_DUE' ? ` ${p && p.target === 1 ? 'day' : 'days'}` : '';
      const share = Math.round((pct * (r.weight ?? 0)) / 100);
      return `${shortRule(r, ctx)} ${p?.value ?? 0} of ${p?.target ?? r.target}${unit} (${pct}%) × ${r.weight}% = ${share}`;
    });
    const total = Math.round(result.after.pct);
    const step = word ? period?.step : result.step;
    const pays = step?.amount ? points(step.amount) : 'nothing';
    const when = word ? `if the ${word} closes now` : 'if it ends now';
    out.weights = `So far${word ? ` this ${word}` : ''}: ${terms.join(', ')}. ${total}%: ${pays} ${when}.`;
  }
  return out;
}

/**
 * [D-126] The first period of the counted goal that starts on or after `start`: one it already has,
 * else the next week (from the household's first day of the week) or month; null for a term not yet
 * known.
 */
export function firstCounted(
  repeat: Exclude<Repeat, 'none'>,
  start: string,
  weekStart: number,
  known: readonly { start: string }[],
): string | null {
  const have = known
    .map((p) => p.start)
    .filter((s) => s >= start)
    .sort()[0];
  if (have) return have;
  const d = new Date(`${start}T12:00:00Z`);
  if (repeat === 'week') {
    while (d.getUTCDay() !== weekStart) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (repeat === 'month') {
    if (d.getUTCDate() !== 1) d.setUTCMonth(d.getUTCMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function orWords(words: string[]): string {
  if (words.length <= 2) return words.join(' or ');
  return `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`;
}

/** Items joined with "or", each keeping its picture. */
function joinParts(items: { icon: string | null; text: string }[]): SummaryPart[] {
  const out: SummaryPart[] = [];
  items.forEach((it, i) => {
    if (i > 0) out.push(i === items.length - 1 ? 'or' : ',');
    out.push(it);
  });
  return out;
}

/** Adds words to the end of a line, onto its last words or after its last item. */
function appendWords(parts: SummaryPart[], words: string) {
  const last = parts.at(-1);
  if (typeof last === 'string') parts[parts.length - 1] = `${last}${words}`;
  else parts.push(words);
}
