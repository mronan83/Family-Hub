import type { LunchChild, LunchDay } from './lunch';
import { type MenuSection, menuSections, pickOne } from './menu/sections';

// [MEAL-13][US-710] The lunch week as a list of days (WP-74, D-98): one child's Monday to Friday,
// each day closed at first with its weekday, its date, Buy or Bring, and a check once it's complete.
// A Buy day is complete when every "Choice of" section (the entree, the milk) has a pick from the
// day's menu as it is now; a Bring day as soon as it's Bring; a day without school is neither.

/** How a day of the list stands: no school lunch, complete, or still without a choice. */
export type LunchDayStatus = 'no-school' | 'complete' | 'to-pick';

/** ISO weekday of a date: 1 Monday … 7 Sunday. */
function isoDow(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** A week's Monday to Friday, in order (a week may start on Sunday or Monday). */
export function schoolWeek(days: LunchDay[]): LunchDay[] {
  return days.filter((d) => isoDow(d.date) <= 5).sort((a, b) => a.date.localeCompare(b.date));
}

/** A day's menu by section, when it has one the school serves that day; otherwise none. */
export function daySections(d: LunchDay): MenuSection[] {
  return d.menu && !d.menu.noService ? menuSections(d.menu.items) : [];
}

/**
 * [MEAL-13] A day's status. Buy: every "Choice of" section of the day's menu has a pick that is
 * still on it (a menu with no such section asks for none). Bring: complete. No lunch: no school.
 */
export function lunchDayStatus(d: LunchDay): LunchDayStatus {
  if (!d.mode) return 'no-school';
  if (d.mode === 'bring') return 'complete';
  const picks = d.choices ?? [];
  const done = daySections(d)
    .filter((s) => pickOne(s.title))
    .every((s) => {
      const p = picks.find((x) => x.section === (s.title ?? ''));
      return !!p && p.options.some((n, i) => s.options[n - 1]?.name === p.names[i]);
    });
  return done ? 'complete' : 'to-pick';
}

/**
 * [MEAL-13] True when a child still has a day without a choice, today or later in the week shown:
 * the dot on their face. Days already gone don't count.
 */
export function hasDaysToPick(child: LunchChild, today: string): boolean {
  return schoolWeek(child.days).some((d) => d.date >= today && lunchDayStatus(d) === 'to-pick');
}

/** The child the list opens on: the one chosen last on this device, else the first. */
export function openOn(children: LunchChild[], last: string | null): string | null {
  return children.find((c) => c.memberId === last)?.memberId ?? children[0]?.memberId ?? null;
}

/** Where this device keeps the child chosen last (WP-73's quick action opens on them too). */
export const LAST_CHILD_KEY = 'fw-lunch-child';

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * [MEAL-12][US-709] The Monday of the lunch week Home's quick action opens (WP-73, D-98): this
 * week's from Monday to Friday, the coming week's on Saturday and Sunday. Calendar dates only, so
 * the household's time zone and DST don't come into it.
 */
export function lunchWeekToOpen(today: string): string {
  const dow = isoDow(today);
  return addDays(today, dow <= 5 ? 1 - dow : 8 - dow);
}

/** How many of a child's days, today or later in the week shown, still have no choice. */
export function daysToPick(child: LunchChild, today: string): number {
  return schoolWeek(child.days).filter((d) => d.date >= today && lunchDayStatus(d) === 'to-pick')
    .length;
}

/**
 * [MEAL-12] What Home's lunch card says (WP-73): "This week: Maya has 1 day to pick; Leo is all
 * set." The coming week's on Saturday and Sunday.
 */
export function lunchQuickWords(
  children: { name: string; toPick: number }[],
  coming: boolean,
): string {
  const each = children.map((c) =>
    c.toPick === 0
      ? `${c.name} is all set`
      : `${c.name} has ${c.toPick} ${c.toPick === 1 ? 'day' : 'days'} to pick`,
  );
  return `${coming ? 'Next week' : 'This week'}: ${each.join('; ')}.`;
}
