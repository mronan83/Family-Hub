// [NFR-15][US-107] Settings (WP-51, D-81): a line for each page it holds, saying how that part of
// FamilyWise stands, so the page doubles as a look at the household's set-up. `warn` marks a line
// that asks for a look.

export interface StatusLine {
  text: string;
  warn: boolean;
}

const ok = (text: string): StatusLine => ({ text, warn: false });
const warn = (text: string): StatusLine => ({ text, warn: true });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string) => SHORT.format(new Date(`${d}T12:00:00Z`));

export interface YearFact {
  name: string;
  startDate: string;
  endDate: string;
  isDefault: boolean;
  archived: boolean;
}

/** [SCH-01] The school year today is in (the household's own first), else the next, else none. */
export function schoolStatus(years: YearFact[], today: string): StatusLine {
  const live = years.filter((y) => !y.archived);
  const now = live
    .filter((y) => y.startDate <= today && today <= y.endDate)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault))[0];
  if (now) return ok(`${now.name} · ends ${shortDate(now.endDate)}`);
  const next = live
    .filter((y) => y.startDate > today)
    .sort((a, b) => (a.startDate < b.startDate ? -1 : 1))[0];
  if (next) return ok(`${next.name} · starts ${shortDate(next.startDate)}`);
  return warn('No school year yet');
}

/** [CAL-06] How many calendars, and the first that can't sync. */
export function calendarsStatus(calendars: { name: string; status: string }[]): StatusLine {
  if (!calendars.length) return ok('None yet');
  const broken = calendars.filter((c) => c.status === 'error');
  if (broken.length === 1) return warn(`${broken[0]!.name} can’t sync`);
  if (broken.length > 1) return warn(`${plural(broken.length, 'calendar')} can’t sync`);
  return ok(plural(calendars.length, 'calendar'));
}

/** [DEV-04] The boards in use: one by name, else how many; none disconnected count. */
export function boardsStatus(boards: { name: string; revoked: boolean }[]): StatusLine {
  const live = boards.filter((b) => !b.revoked);
  if (!live.length) return ok('No boards yet');
  return ok(live.length === 1 ? live[0]!.name : plural(live.length, 'board'));
}

/** [CHR-10] How many tags are in use (archived ones aside). */
export function tagsStatus(tags: { archived: boolean }[]): StatusLine {
  const n = tags.filter((t) => !t.archived).length;
  return ok(n ? plural(n, 'tag') : 'No tags yet');
}

/** [CHR-15] The signed-in parent's own reminders: off, or on for how many of their devices. */
export function remindersStatus(
  linked: boolean,
  enabled: boolean,
  devices: { enabled: boolean }[],
): StatusLine {
  if (!linked || !enabled) return ok('Off');
  const on = devices.filter((d) => d.enabled).length;
  return on ? ok(`On for ${plural(on, 'device')}`) : warn('On, but no device gets them');
}

/** [NFR-07] The jobs that need a look, and calendars that can't sync. */
export function healthStatus(jobsNeedingLook: number, brokenCalendars: number): StatusLine {
  const n = jobsNeedingLook + brokenCalendars;
  return n ? warn(`${plural(n, 'thing')} to look at`) : ok('Everything is running');
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** [ACC-08][CHR-05] Family options: the week's start day (and a change waiting), and check-offs. */
export function familyStatus(
  weekStart: number,
  next: { day: number; on: string } | null,
  approval: 'on' | 'off',
): StatusLine {
  const week = next
    ? `Week starts ${DAYS[next.day]} from ${shortDate(next.on)}`
    : `Week starts ${DAYS[weekStart]}`;
  return ok(`${week} · check-offs ${approval === 'on' ? 'wait for a parent' : 'count at once'}`);
}
