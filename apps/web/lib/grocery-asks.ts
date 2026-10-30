import { z } from 'zod';
import type { GroceryBrand } from './grocery-brands';
import type { GroceryItem } from './groceries';
import { itemKey } from './grocery-merge';

// [MEAL-22][MEAL-30] Asking, ticking off and taking off on the board's Groceries (WP-107, D-149):
// the Asked for card's words, the 11 tiles, the brand row, what a member may take off, the face
// kept for 2 minutes, Got today, and the board's calls (POST /api/groceries). Pure but for the calls.

/** An ask as the board's card shows it (board_groceries().asks). */
export interface BoardAsk {
  id: string;
  memberId: string;
  name: string;
  brandId: string | null;
  status: 'waiting' | 'added' | 'declined';
  /** The item it went on the list as, or joined: open, ticked or removed; none while it waits. */
  itemStatus: 'open' | 'ticked' | 'removed' | null;
  /** Its item was ticked today, in the household's day. */
  gotToday: boolean;
  askedAt: string;
}

/** A thing ticked today (board_groceries().got), newest first. */
export interface BoardGot {
  id: string;
  name: string;
  brandId: string | null;
  categoryId: string;
  tickedAt: string;
  /** Who ticked it at a board; none when it was ticked in the admin app. */
  memberId: string | null;
}

/** A thing the household has had (board_groceries().known), most bought first. */
export interface KnownThing {
  key: string;
  name: string;
  categoryId: string;
  /** How many times it was ticked. */
  buys: number;
  /** The brands it has had, newest first. */
  brandIds: string[];
}

// ---------------------------------------------------------------------------------------------
// [MEAL-22] The Asked for card
// ---------------------------------------------------------------------------------------------

export type AskState = 'waiting' | 'on' | 'got' | 'no';

export const ASK_WORDS: Record<AskState, string> = {
  waiting: 'Waiting for a grown-up',
  on: 'On the list',
  got: 'Got it!',
  no: 'Not this time',
};

/**
 * [MEAL-22-f] How an ask stands on the board's card: waiting; on the list while its item is open;
 * "Got it!" once its item is ticked today; "Not this time" (the database sends only today's). An ask
 * whose item was taken off, or ticked before today, isn't shown.
 */
export function askState(a: BoardAsk): AskState | null {
  if (a.status === 'waiting') return 'waiting';
  if (a.status === 'declined') return 'no';
  if (a.gotToday) return 'got';
  return a.itemStatus === 'open' ? 'on' : null;
}

/** The card's asks: waiting first, then on the list, got and turned down, newest first in each. */
export function askCard(asks: readonly BoardAsk[]): { ask: BoardAsk; state: AskState }[] {
  const rank: Record<AskState, number> = { waiting: 0, on: 1, got: 2, no: 3 };
  return asks
    .map((ask) => ({ ask, state: askState(ask) }))
    .filter((x): x is { ask: BoardAsk; state: AskState } => x.state !== null)
    .sort((a, b) => rank[a.state] - rank[b.state] || b.ask.askedAt.localeCompare(a.ask.askedAt));
}

/** [MEAL-22-c] A child has at most this many asks waiting. */
export const MAX_WAITING = 5;

export function waitingFor(asks: readonly BoardAsk[], memberId: string): number {
  return asks.filter((a) => a.memberId === memberId && a.status === 'waiting').length;
}

// ---------------------------------------------------------------------------------------------
// [MEAL-22] The tiles, the matches as one types, the brand row
// ---------------------------------------------------------------------------------------------

/** A made-up starter set, until the household has bought things (D-138 (8)). */
export const STARTER_TILES = [
  'Milk',
  'Bananas',
  'Apples',
  'Eggs',
  'Bread',
  'Orange juice',
  'Cookies',
  'Grapes',
  'Strawberries',
  'Juice boxes',
  'Yogurt',
] as const;

export const TILE_COUNT = 11;

export interface AskTile {
  name: string;
  key: string;
  /** On the list already (a tap adds the asker to it), or asked by this member and waiting. */
  mark: 'on' | 'asked' | null;
}

/**
 * [MEAL-22-f] The 11 tiles: the things the household buys most, then the starter set for the rest;
 * each marked "On the list" or, for the one asking, "Asked".
 */
export function askTiles(
  known: readonly KnownThing[],
  open: readonly Pick<GroceryItem, 'name'>[],
  asks: readonly BoardAsk[],
  memberId: string | null,
): AskTile[] {
  const out: { name: string; key: string }[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = itemKey(name);
    if (!key || seen.has(key) || out.length >= TILE_COUNT) return;
    seen.add(key);
    out.push({ name, key });
  };
  for (const k of [...known].filter((k) => k.buys > 0).sort((a, b) => b.buys - a.buys)) add(k.name);
  for (const s of STARTER_TILES) add(s);
  const onList = new Set(open.map((i) => itemKey(i.name)));
  const asked = new Set(
    asks
      .filter((a) => a.memberId === memberId && a.status === 'waiting')
      .map((a) => itemKey(a.name)),
  );
  return out.map((t) => ({
    ...t,
    mark: onList.has(t.key) ? 'on' : asked.has(t.key) ? 'asked' : null,
  }));
}

/** [MEAL-22] Up to 3 things the household has had that match what is typed, the closest first. */
export function askMatches(typed: string, known: readonly KnownThing[]): KnownThing[] {
  const key = itemKey(typed);
  if (!key) return [];
  const starts = known.filter((k) => k.key.startsWith(key));
  const holds = known.filter((k) => !k.key.startsWith(key) && k.key.includes(key));
  return [...starts, ...holds].slice(0, 3);
}

export interface BrandRow {
  /** The household's brands this thing has had, last time's first; archived ones left out. */
  brands: GroceryBrand[];
  /** The brand picked to start: last time's, or none. */
  picked: string | null;
}

/**
 * [MEAL-22-g] The brand row under the tiles (D-149 (5)): the household's brands this thing has had,
 * last time's first and picked; empty for a thing that never had a brand (it asks at once).
 */
export function brandRow(
  name: string,
  known: readonly KnownThing[],
  brands: readonly GroceryBrand[],
): BrandRow {
  const key = itemKey(name);
  const thing = known.find((k) => k.key === key);
  const live = (thing?.brandIds ?? [])
    .map((id) => brands.find((b) => b.id === id))
    .filter((b): b is GroceryBrand => !!b && !b.archived);
  return { brands: live, picked: live[0]?.id ?? null };
}

// ---------------------------------------------------------------------------------------------
// [MEAL-30] Ticking off and taking off
// ---------------------------------------------------------------------------------------------

/** [MEAL-30-c] The face picked stays picked this long, so a bag of shopping is two taps a thing. */
export const FACE_HOLD_MS = 2 * 60_000;

export interface HeldFace {
  memberId: string;
  at: number;
}

/** The face still picked at `now`, or none once 2 minutes have passed. */
export function heldFace(held: HeldFace | null, now: number): string | null {
  return held && now - held.at < FACE_HOLD_MS ? held.memberId : null;
}

/**
 * [MEAL-30-b] Whether a member may take a thing off at the board (D-149 (1)): an adult anything; a
 * child only a thing every reason of which is their own ask.
 */
export function canTakeOff(
  item: Pick<GroceryItem, 'reasons'>,
  member: { id: string; role: 'child' | 'adult' },
): boolean {
  if (member.role === 'adult') return true;
  return (
    item.reasons.length > 0 &&
    item.reasons.every((r) => r.kind === 'ask' && r.memberId === member.id)
  );
}

/** [MEAL-30-c] Got today's card: up to 5, newest first, and how many more. */
export function gotTodayCard(
  got: readonly BoardGot[],
  limit = 5,
): { shown: BoardGot[]; more: number } {
  const sorted = [...got].sort((a, b) => b.tickedAt.localeCompare(a.tickedAt));
  return { shown: sorted.slice(0, limit), more: Math.max(0, sorted.length - limit) };
}

/** [MEAL-30-c] Got recently in the admin app: "by Leo at the Kitchen board", "by Sam". */
export function gotByWords(who: string | null, board: string | null): string {
  if (!who) return '';
  return board ? ` by ${who} at the ${board} board` : ` by ${who}`;
}

/** How long the Undo bar stays after taking a thing off (D-149 (2)). */
export const UNDO_MS = 10_000;

// ---------------------------------------------------------------------------------------------
// The words the board says back
// ---------------------------------------------------------------------------------------------

export interface AskAnswer {
  status: 'waiting' | 'added';
  already: boolean;
}

/** [MEAL-22-g] What the bar says after an ask. */
export function askAnswerWords(answer: AskAnswer, name: string, who: string): string {
  if (answer.already) return 'Already on the list! We added that you asked.';
  if (answer.status === 'added') return `Added ${name} to the list.`;
  return `Asked for ${name}, ${who}. A grown-up will say OK.`;
}

/** A refusal in the board's words. */
export function groceryRefusalWords(reason: string): string {
  switch (reason) {
    case 'too_many':
      return `You have ${MAX_WAITING} asks waiting. Call one off, or wait for a grown-up.`;
    case 'not_yours':
      return 'Only a grown-up can take this off.';
    case 'not_found':
      return 'That has changed. Look again.';
    default:
      return 'That didn’t work. Try again in a moment.';
  }
}

// ---------------------------------------------------------------------------------------------
// The board's calls: POST /api/groceries
// ---------------------------------------------------------------------------------------------

const ids = z.array(z.guid()).min(1).max(50);

/** What a board may send (01 §5.7). */
export const groceryActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('ask'),
      member_id: z.guid(),
      name: z.string().trim().min(1).max(80),
      brand_id: z.guid().nullable().default(null),
    })
    .strict(),
  z.object({ action: z.literal('call_off'), ask_id: z.guid() }).strict(),
  z.object({ action: z.literal('tick'), member_id: z.guid(), ids, ticked: z.boolean() }).strict(),
  z.object({ action: z.literal('remove'), member_id: z.guid(), ids }).strict(),
  z.object({ action: z.literal('restore'), member_id: z.guid(), ids }).strict(),
]);
export type GroceryAction = z.input<typeof groceryActionSchema>;

/** How a call went: done (with the database's answer), not sent (offline), or refused and why. */
export type GroceryAnswer =
  { ok: true; data: unknown } | { ok: false; offline: true } | { ok: false; reason: string };

export type PostGroceries = (action: GroceryAction) => Promise<GroceryAnswer>;

/** POST /api/groceries. Not queued: the board says at once whether it worked. */
export const postGroceries: PostGroceries = async (action) => {
  let res: Response;
  try {
    res = await fetch('/api/groceries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(action),
    });
  } catch {
    return { ok: false, offline: true };
  }
  const answer = (await res.json().catch(() => null)) as { error?: unknown; data?: unknown } | null;
  if (res.ok) return { ok: true, data: answer?.data ?? null };
  if (res.status >= 400 && res.status < 500 && ![401, 408, 429].includes(res.status))
    return { ok: false, reason: typeof answer?.error === 'string' ? answer.error : 'refused' };
  return { ok: false, offline: true };
};

/** The ask's answer from the database, or null when it isn't one. */
export function readAskAnswer(x: unknown): AskAnswer | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (o.status !== 'waiting' && o.status !== 'added') return null;
  return { status: o.status, already: o.already === true };
}
