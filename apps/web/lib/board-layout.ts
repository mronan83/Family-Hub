// [BRD-05][US-1004] The board's home screen layout (WP-35, D-67): how many days its calendar shows
// (or the month), and which cards show under it, in order. The household has one; a board may have
// its own, else it follows the household's. Stored as `household_settings.board_layout` and a board's
// `board_config.layout`; `private.valid_board_layout()` checks the same shape.

export type CalendarSpan = '3' | '5' | '7' | 'month';
export type CardId = 'meals' | 'goals' | 'waiting' | 'coming';

export const CALENDAR_SPANS: readonly CalendarSpan[] = ['3', '5', '7', 'month'];
/** The cards in their default order. */
export const CARD_IDS: readonly CardId[] = ['meals', 'goals', 'waiting', 'coming'];

export const SPAN_LABELS: Record<CalendarSpan, string> = {
  '3': '3 days',
  '5': '5 days',
  '7': '7 days',
  month: 'Month',
};

export const CARD_LABELS: Record<CardId, { label: string; note: string }> = {
  meals: { label: 'Dinner and lunch', note: 'Shows once meals are planned' },
  goals: { label: 'Goals', note: 'Everyone’s goals and how close they are' },
  waiting: { label: 'Waiting for a parent', note: 'Requests and check-offs to approve' },
  coming: { label: 'Coming up', note: 'All-day events in the next three weeks' },
};

export interface LayoutCard {
  id: CardId;
  show: boolean;
}

/** A layout with every card, in order. */
export interface BoardLayout {
  calendar: CalendarSpan;
  cards: LayoutCard[];
}

export const DEFAULT_LAYOUT: BoardLayout = {
  calendar: '5',
  cards: CARD_IDS.map((id) => ({ id, show: true })),
};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

/**
 * A stored layout as the board uses it: what is missing or not understood takes its default, and a
 * card not listed shows after those listed. Null when there is none (a board following the household).
 */
export function readLayout(x: unknown): BoardLayout | null {
  if (x === null || x === undefined) return null;
  if (!isObject(x)) return structuredClone(DEFAULT_LAYOUT);
  const calendar = CALENDAR_SPANS.find((s) => s === x.calendar) ?? DEFAULT_LAYOUT.calendar;
  const cards: LayoutCard[] = [];
  if (Array.isArray(x.cards)) {
    for (const c of x.cards) {
      if (!isObject(c)) continue;
      const id = CARD_IDS.find((i) => i === c.id);
      if (!id || cards.some((k) => k.id === id) || typeof c.show !== 'boolean') continue;
      cards.push({ id, show: c.show });
    }
  }
  for (const id of CARD_IDS) if (!cards.some((c) => c.id === id)) cards.push({ id, show: true });
  return { calendar, cards };
}

/** What a board shows: its own layout if it has one, else the household's, else the defaults. */
export function effectiveLayout(household: unknown, board: unknown): BoardLayout {
  return readLayout(board) ?? readLayout(household) ?? structuredClone(DEFAULT_LAYOUT);
}

/** One card a place up (-1) or down (1); at either end, as it was. */
export function moveCard(layout: BoardLayout, id: CardId, dir: -1 | 1): BoardLayout {
  const i = layout.cards.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layout.cards.length) return layout;
  const cards = [...layout.cards];
  [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  return { ...layout, cards };
}

/** Parses the admin form: the span, the order (ids), and the ids ticked to show. */
export function layoutFromForm(span: unknown, order: unknown[], shown: unknown[]): BoardLayout {
  const calendar = CALENDAR_SPANS.find((s) => s === span) ?? DEFAULT_LAYOUT.calendar;
  const ids = order.filter((o): o is CardId => CARD_IDS.includes(o as CardId));
  const listed = [...new Set(ids)];
  for (const id of CARD_IDS) if (!listed.includes(id)) listed.push(id);
  return { calendar, cards: listed.map((id) => ({ id, show: shown.includes(id) })) };
}
