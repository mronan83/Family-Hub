import type { IconName } from '@familywise/ui';

// [NFR-17][US-109] Home's alerts (WP-57, D-84): what a parent needs to know, each with where to deal
// with it. An alert is shown while its cause lasts and goes when it is dealt with; none can be
// dismissed. "Needs you" asks for something now; "Heads-up" is worth knowing soon.

export type AlertLevel = 'act' | 'note';

export interface HomeAlert {
  key: string;
  level: AlertLevel;
  icon: IconName;
  text: string;
  href: string;
  cta: string;
}

export interface AlertFacts {
  /** Now, as an ISO timestamp, and today in the household's time zone (YYYY-MM-DD). */
  now: string;
  today: string;
  approvals: number;
  requests: number;
  boards: { name: string; lastSeenAt: string | null; revoked: boolean }[];
  calendars: { name: string; status: string }[];
  /** Menu feeds only (a file or typed-in menu can't fail). */
  menuFeeds: { name: string; status: string }[];
  jobsNeedingLook: number;
  weather: { place: string | null; failedAt: string | null };
  /** The school year today is in, or the next one; null when there is none. */
  schoolYear: { name: string; startDate: string; endDate: string } | null;
  /** Whether next week has school, and how many of its days have a school menu. */
  nextWeek: { school: boolean; menuDays: number };
  /** Whether the household has any school menu, from a feed, a file or by hand. */
  hasMenus: boolean;
  invites: { email: string; expiresAt: string }[];
}

/** A board is missed once it hasn't reported in for this long (it does every 5 minutes). */
export const BOARD_QUIET_MINUTES = 15;
const SCHOOL_ENDS_SOON_DAYS = 14;
const INVITE_SOON_HOURS = 48;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutesBetween = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 60_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDate = (d: string) => SHORT.format(new Date(`${d}T12:00:00Z`));

/** "15 minutes", "3 hours", "2 days". */
export function howLong(minutes: number): string {
  if (minutes < 90) return plural(Math.max(1, Math.round(minutes)), 'minute');
  if (minutes < 48 * 60) return plural(Math.round(minutes / 60), 'hour');
  return plural(Math.round(minutes / 1440), 'day');
}

/** [NFR-17] The alerts, "Needs you" first, each kind in a fixed order. */
export function homeAlerts(f: AlertFacts): HomeAlert[] {
  const out: HomeAlert[] = [];
  const act = (a: Omit<HomeAlert, 'level'>) => out.push({ ...a, level: 'act' });
  const note = (a: Omit<HomeAlert, 'level'>) => out.push({ ...a, level: 'note' });

  if (f.approvals > 0) {
    act({
      key: 'approvals',
      icon: 'check',
      text: `${plural(f.approvals, 'check-off')} ${f.approvals === 1 ? 'waits' : 'wait'} for you`,
      href: '/admin/today',
      cta: 'Review',
    });
  }
  if (f.requests > 0) {
    act({
      key: 'requests',
      icon: 'gift',
      text: `${plural(f.requests, 'reward request')} ${f.requests === 1 ? 'waits' : 'wait'} for you`,
      href: '/admin/rewards',
      cta: 'Decide',
    });
  }
  for (const b of f.boards) {
    if (b.revoked) continue;
    const quiet = b.lastSeenAt ? minutesBetween(b.lastSeenAt, f.now) : Infinity;
    if (quiet < BOARD_QUIET_MINUTES) continue;
    act({
      key: `board:${b.name}`,
      icon: 'board',
      text: b.lastSeenAt
        ? `${b.name} hasn’t been seen for ${howLong(quiet)}`
        : `${b.name} hasn’t been seen since it was paired`,
      href: '/admin/devices',
      cta: 'Boards',
    });
  }
  const broken = f.calendars.filter((c) => c.status === 'error');
  if (broken.length) {
    act({
      key: 'calendars',
      icon: 'calendar',
      text:
        broken.length === 1
          ? `${broken[0]!.name} can’t sync`
          : `${plural(broken.length, 'calendar')} can’t sync`,
      href: '/admin/calendars',
      cta: 'Calendars',
    });
  }
  const failing = f.menuFeeds.filter((m) => m.status === 'error');
  if (failing.length) {
    act({
      key: 'menus',
      icon: 'utensils',
      text:
        failing.length === 1
          ? `The ${failing[0]!.name} menu can’t be read`
          : `${plural(failing.length, 'school menu')} can’t be read`,
      href: '/admin/meals/menus',
      cta: 'School menus',
    });
  }
  if (f.jobsNeedingLook > 0) {
    act({
      key: 'jobs',
      icon: 'activity',
      text: `${plural(f.jobsNeedingLook, 'background job')} ${f.jobsNeedingLook === 1 ? 'needs' : 'need'} a look`,
      href: '/admin/health',
      cta: 'Health',
    });
  }

  if (f.hasMenus && f.nextWeek.school && f.nextWeek.menuDays === 0) {
    note({
      key: 'menu-next-week',
      icon: 'utensils',
      text: 'No school menu for next week yet',
      href: '/admin/meals/menus',
      cta: 'School menus',
    });
  }
  const y = f.schoolYear;
  if (!y) {
    note({
      key: 'school-none',
      icon: 'backpack',
      text: 'No school year is set up',
      href: '/admin/school',
      cta: 'School',
    });
  } else if (y.startDate <= f.today && daysBetween(f.today, y.endDate) <= SCHOOL_ENDS_SOON_DAYS) {
    note({
      key: 'school-ends',
      icon: 'backpack',
      text: `${y.name} ends ${shortDate(y.endDate)}; is next year set up?`,
      href: '/admin/school',
      cta: 'School',
    });
  }
  if (f.weather.place && f.weather.failedAt) {
    note({
      key: 'weather',
      icon: 'cloud',
      text: `The weather hasn’t updated for ${howLong(minutesBetween(f.weather.failedAt, f.now))}`,
      href: '/admin/settings/family#weather',
      cta: 'Weather',
    });
  }
  for (const i of f.invites) {
    const left = (Date.parse(i.expiresAt) - Date.parse(f.now)) / 3_600_000;
    if (left > 0 && left <= INVITE_SOON_HOURS) {
      note({
        key: `invite:${i.email}`,
        icon: 'mail',
        text: `${i.email}’s invite runs out in ${howLong(left * 60)}`,
        href: '/admin/settings/family#invite',
        cta: 'Invites',
      });
    }
  }
  return out;
}
