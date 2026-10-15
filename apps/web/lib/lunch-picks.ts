import { z } from 'zod';
import type { LunchDay, LunchMode, LunchPick } from './lunch';
import {
  entreeSection,
  type MenuSection,
  optionWords,
  pickOne,
  sectionLabel,
} from './menu/sections';

// [MEAL-09][MEAL-11][US-707] Next week's lunches picked on the board (WP-49, D-95): the coming week,
// a day's picks from its menu (one option where a section says "Choice of", any number in the others,
// D-94), the words the board and Meals say them in, and the call a board makes. The database decides
// (request_lunch(): a child's change waits for a parent; the cut-off; the picks against the menu).

const DAY_MS = 86_400_000;

function shift(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO weekday of a date: 1 Monday … 7 Sunday. */
function isoDow(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** [MEAL-09] Reads of the lunch week a board makes before it says the week can't be read (WP-77). */
export const WEEK_READS = 3;
/** The wait before reading the lunch week again after a read fails. */
export const WEEK_READ_WAIT_MS = 1_000;

/**
 * [MEAL-09] Reads the lunch week, reading again after a failed read (null), up to `tries` reads with
 * `wait` ms between them (WP-77). Before, one failed read after a change left the board showing the
 * week from before the change, with nothing to say so. Null when every read failed.
 */
export async function readWeek<T>(
  load: () => Promise<T | null>,
  tries = WEEK_READS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  stop: () => boolean = () => false,
): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    if (i > 0) {
      await wait(WEEK_READ_WAIT_MS);
      if (stop()) return null;
    }
    const got = await load().catch(() => null);
    if (got !== null || stop()) return got;
  }
  return null;
}

/**
 * [MEAL-09] The coming school week, Monday to Friday (D-94): on a Saturday or Sunday the week after
 * it; on a weekday this week (its earlier days are locked). `weeks` moves it on by whole weeks.
 */
export function comingWeek(today: string, weeks = 0): string[] {
  const dow = isoDow(today);
  const monday = dow >= 6 ? shift(today, 8 - dow) : shift(today, 1 - dow);
  return Array.from({ length: 5 }, (_, i) => shift(monday, i + weeks * 7));
}

/** The day as the child sees it: what they asked for while it waits, else the day as it is. */
export function shownDay(d: LunchDay): { mode: LunchMode | null; picks: LunchPick[] } {
  if (d.request?.status === 'waiting') return { mode: d.request.mode, picks: d.request.choices };
  return { mode: d.mode, picks: d.mode === 'buy' ? (d.choices ?? []) : [] };
}

/** Picks in the menu's order of sections (the database keeps them by section title). */
export function inMenuOrder(picks: LunchPick[], sections: MenuSection[] | null): LunchPick[] {
  if (!sections?.length) return picks;
  const order = sections.map((s) => s.title ?? '');
  const at = (p: LunchPick) => {
    const i = order.indexOf(p.section);
    return i < 0 ? order.length : i;
  };
  return [...picks].sort((a, b) => at(a) - at(b) || a.section.localeCompare(b.section));
}

/** [MEAL-11] Picks in words, a section each: "Cheese pizza · Apple slices, Baby carrots · 1% milk". */
export function picksWords(picks: LunchPick[], sections: MenuSection[] | null = null): string {
  return inMenuOrder(picks, sections)
    .map((p) => p.names.join(', '))
    .filter(Boolean)
    .join(' · ');
}

/**
 * [MEAL-11] What the board's home screen says of a buy day with picks: the entree picked, with its
 * sides from the menu ("Chicken wrap with Tortilla chips"); else every pick. Null with no picks.
 */
export function entreePickWords(picks: LunchPick[], sections: MenuSection[] | null): string | null {
  if (!picks.length) return null;
  const entree = sections ? entreeSection(sections) : null;
  const pick = entree ? picks.find((p) => p.section === (entree.title ?? '')) : undefined;
  if (!pick) return picksWords(picks, sections);
  return pick.options
    .map((n, i) => {
      const o = entree!.options[n - 1];
      return o && o.name === pick.names[i] ? optionWords(o) : pick.names[i]!;
    })
    .join(', ');
}

/**
 * [MEAL-11] True when a pick no longer matches the day's menu: a section gone, or an option whose
 * name changed since it was picked (the pick is kept, and marked "Menu changed").
 */
export function menuChanged(picks: LunchPick[], sections: MenuSection[] | null): boolean {
  if (!picks.length) return false;
  if (!sections) return true;
  return picks.some((p) => {
    const s = sections.find((x) => (x.title ?? '') === p.section);
    return !s || p.options.some((n, i) => s.options[n - 1]?.name !== p.names[i]);
  });
}

/**
 * [MEAL-11] A tap on an option: in a "Choice of" section it becomes the one picked (a second tap
 * takes it off); anywhere else it is added or taken off. A section with nothing picked goes.
 */
export function togglePick(picks: LunchPick[], section: MenuSection, option: number): LunchPick[] {
  const key = section.title ?? '';
  const name = section.options[option - 1]?.name;
  if (!name) return picks;
  const rest = picks.filter((p) => p.section !== key);
  const mine = picks.find((p) => p.section === key);
  const had = mine?.options.includes(option) ?? false;
  let options: number[];
  if (pickOne(section.title)) options = had ? [] : [option];
  else if (had) options = mine!.options.filter((o) => o !== option);
  else options = [...(mine?.options ?? []), option].sort((a, b) => a - b);
  if (!options.length) return rest;
  const names = options.map((o) => section.options[o - 1]!.name);
  return [...rest, { section: key, options, names }];
}

/** True when a section of a buy day still needs its one pick ("Choice of" with nothing picked). */
export function missingPicks(picks: LunchPick[], sections: MenuSection[] | null): string[] {
  return (sections ?? [])
    .filter((s) => pickOne(s.title) && !picks.some((p) => p.section === (s.title ?? '')))
    .map((s) => sectionLabel(s.title!));
}

/** Two sets of picks are the same: the same options in the same sections. */
export function samePicks(a: LunchPick[], b: LunchPick[]): boolean {
  const key = (x: LunchPick[]) =>
    JSON.stringify(
      [...x]
        .map((p) => [p.section, [...p.options].sort((m, n) => m - n)] as const)
        .sort((m, n) => m[0].localeCompare(n[0])),
    );
  return key(a) === key(b);
}

/** [MEAL-09] What a day's line says on the board, in a child's words (06 §2). */
export function dayLine(d: LunchDay): string | null {
  if (d.request?.status === 'waiting') return 'Waiting for a parent';
  if (d.request?.status === 'kept')
    return `${d.request.decidedBy ?? 'A parent'} kept ${d.mode === 'buy' ? 'Buy' : 'Bring'}`;
  return null;
}

const pickSchema = z
  .object({
    section: z.string().max(60),
    options: z.array(z.number().int().min(1).max(60)).min(1).max(60),
    names: z.array(z.string().min(1).max(120)).min(1).max(60),
  })
  .strict()
  .refine((p) => p.options.length === p.names.length, 'an option each name');

/** [MEAL-09][MEAL-11] A board asks for a child's day: buy or bring, and a buy day's picks. */
export const lunchRequestSchema = z
  .object({
    member_id: z.guid(),
    date: z.iso.date(),
    mode: z.enum(['buy', 'bring']),
    choices: z.array(pickSchema).max(20).default([]),
  })
  .strict();

/** [US-707] A board says a child has looked at their week (Done). */
export const lunchSeenSchema = z.object({ member_id: z.guid() }).strict();

/** How a change went: sent (waiting, or taken back); not sent (offline); or refused, and why. */
export type LunchAnswer =
  { ok: true; waiting: boolean } | { ok: false; offline: true } | { ok: false; reason: string };

export type AskLunch = (
  memberId: string,
  date: string,
  mode: LunchMode,
  choices: LunchPick[],
) => Promise<LunchAnswer>;
export type SeenLunch = (memberId: string) => Promise<boolean>;

/** [MEAL-09] POST /api/lunches. Not queued: a change is a conversation with a parent. */
export const postLunch: AskLunch = async (memberId, date, mode, choices) => {
  let res: Response;
  try {
    res = await fetch('/api/lunches', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, date, mode, choices }),
    });
  } catch {
    return { ok: false, offline: true };
  }
  const answer = (await res.json().catch(() => null)) as {
    error?: unknown;
    lunch?: { waiting?: unknown };
  } | null;
  if (res.ok) return { ok: true, waiting: answer?.lunch?.waiting === true };
  if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status))
    return { ok: false, reason: typeof answer?.error === 'string' ? answer.error : 'refused' };
  return { ok: false, offline: true };
};

/** [US-707] POST /api/lunches/seen: a parent's "kept" lines go once the child has seen them. */
export const postLunchSeen: SeenLunch = async (memberId) => {
  try {
    const res = await fetch('/api/lunches/seen', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ member_id: memberId }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** A refusal in a child's words. */
export function lunchAnswerWords(reason: string): string {
  switch (reason) {
    case 'locked':
      return 'That day can’t change now.';
    case 'not_on_menu':
      return 'The menu changed. Pick again.';
    case 'pick_one':
      return 'Pick just one of those.';
    case 'no_menu':
      return 'There’s no menu to pick from yet.';
    default:
      return 'That didn’t save. Ask a grown-up.';
  }
}

/** [MEAL-09] The cut-off in words: "8:00 am". */
export function cutoffWords(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = ((h! + 11) % 12) + 1;
  return `${hour}:${String(m ?? 0).padStart(2, '0')} ${h! < 12 ? 'am' : 'pm'}`;
}

/** [MEAL-11] An option's value in the parent's picks form on Meals: its section, number and name. */
export function pickValue(section: string, option: number, name: string): string {
  return JSON.stringify([section, option, name]);
}

/**
 * [MEAL-11] The name of a section's inputs in the parent's picks form on Meals: one a section
 * (`pick-0`, `pick-1` …). Radios that share a name are one group, so with one name for the form a
 * pick in one "Choice of" section took the pick off another: a milk took off the entree (WP-78).
 */
export function pickName(section: number): string {
  return `pick-${section}`;
}

/** A section's inputs, and `pick`: the one name of a form loaded before WP-78. */
const PICK_NAME = /^pick(-\d+)?$/;

/**
 * [MEAL-11] The parent's picks form on Meals, as picks: each ticked option (`pick-N`, a section
 * each), grouped by section. Anything malformed is left out; the database checks the rest against
 * the menu.
 */
export function parsePicksForm(form: FormData): LunchPick[] {
  const picks = new Map<string, LunchPick>();
  for (const [field, raw] of form.entries()) {
    if (!PICK_NAME.test(field)) continue;
    let v: unknown;
    try {
      v = JSON.parse(String(raw));
    } catch {
      continue;
    }
    if (!Array.isArray(v) || v.length !== 3) continue;
    const [section, option, name] = v as [unknown, unknown, unknown];
    if (typeof section !== 'string' || !Number.isInteger(option) || typeof name !== 'string')
      continue;
    const p = picks.get(section) ?? { section, options: [], names: [] };
    if (p.options.includes(option as number)) continue;
    p.options.push(option as number);
    p.names.push(name);
    picks.set(section, p);
  }
  return [...picks.values()];
}
