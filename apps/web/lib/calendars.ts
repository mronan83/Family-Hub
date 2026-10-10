import { MEMBER_COLORS, type MemberColor } from '@familywise/ui';
import { icsUrl } from './calendar/ics';
import { day, dayAndTime, time } from './format';

// [CAL-01][CAL-03][CAL-06] The household's calendars in the admin portal (WP-22, D-63): a name, a
// color and optionally whose it is, and the published link, which goes to Vault and is never shown
// again. Events come only from the calendar itself (read-only, CAL-03).

export interface CalendarInput {
  name: string;
  /** The link to fetch (https), or null to keep the one in Vault. */
  url: string | null;
  color: MemberColor;
  memberId: string | null;
  showOnBoard: boolean;
}

export type ParsedCalendar = { ok: true; value: CalendarInput } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LINK_HELP =
  'Paste the calendar’s public link: in Apple Calendar, open the calendar’s settings, turn on Public Calendar and copy the link (it starts with webcal://).';

/** A calendar form, checked as the database will check it. A new calendar needs its link. */
export function parseCalendar(form: FormData, isNew: boolean): ParsedCalendar {
  const name = String(form.get('name') ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 40) {
    return { ok: false, message: 'Give the calendar a name of up to 40 characters.' };
  }
  const raw = String(form.get('url') ?? '').trim();
  let url: string | null = null;
  if (raw) {
    try {
      url = icsUrl(raw).href;
    } catch {
      return { ok: false, message: LINK_HELP };
    }
    if (url.length > 2000) return { ok: false, message: LINK_HELP };
  } else if (isNew) {
    return { ok: false, message: LINK_HELP };
  }
  const color = String(form.get('color') ?? 'member-6');
  if (!(MEMBER_COLORS as readonly string[]).includes(color)) {
    return { ok: false, message: 'Choose a color.' };
  }
  const member = String(form.get('memberId') ?? '');
  if (member && !UUID.test(member)) return { ok: false, message: 'Choose whose calendar it is.' };
  return {
    ok: true,
    value: {
      name,
      url,
      color: color as MemberColor,
      memberId: member || null,
      showOnBoard: form.get('showOnBoard') === 'on',
    },
  };
}

export function calendarSaveMessage(error: { code?: string | null; hint?: string | null }): string {
  if (error.hint === 'bad_link') return LINK_HELP;
  if (error.hint === 'not_found') return 'That calendar was removed. Reload the page.';
  if (error.code === '23503') return 'Choose someone who is still in the family.';
  return 'That didn’t save. Try again in a moment.';
}

export type CalendarStatus = 'pending' | 'ok' | 'error' | 'disabled';

export interface CalendarRow {
  id: string;
  name: string;
  color: MemberColor;
  memberId: string | null;
  showOnBoard: boolean;
  status: CalendarStatus;
  lastSyncedAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  /** Instances from now to the end of the window. */
  upcomingCount: number;
  /** The next few of them. */
  upcoming: UpcomingEvent[];
}

export interface UpcomingEvent {
  id: string;
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  /** Household-local, the last day inclusive. */
  startDate: string;
  endDate: string;
  changed: boolean;
}

/** [US-505] What a calendar's sync last did, in words, and how it looks. */
export function syncStatus(
  c: Pick<CalendarRow, 'status' | 'lastSyncedAt' | 'lastSuccessAt' | 'lastError'>,
  timeZone: string,
): { kind: 'ok' | 'error' | 'pending'; label: string; detail: string } {
  if (c.status === 'error') {
    return {
      kind: 'error',
      label: 'Can’t sync',
      detail: `${c.lastError ?? 'The last sync failed.'} ${
        c.lastSuccessAt
          ? `Last good sync ${dayAndTime(c.lastSuccessAt, timeZone)}: the board keeps showing its events.`
          : 'No events yet.'
      }`,
    };
  }
  if (c.status === 'ok' && c.lastSyncedAt) {
    return {
      kind: 'ok',
      label: 'Synced',
      detail: `Last synced ${dayAndTime(c.lastSyncedAt, timeZone)}. It syncs every 15 minutes.`,
    };
  }
  return { kind: 'pending', label: 'Not synced yet', detail: 'It syncs within 15 minutes.' };
}

/** "Tue, Oct 20 · 5:00 pm" or, all day, "Wed, Nov 25 – Sat, Nov 28 · All day". */
export function whenWords(e: UpcomingEvent, timeZone: string): string {
  if (e.allDay) {
    // Dates as dates: noon UTC names the same day in every zone.
    const first = day(`${e.startDate}T12:00:00Z`, 'UTC');
    const last = day(`${e.endDate}T12:00:00Z`, 'UTC');
    return `${e.startDate === e.endDate ? first : `${first} – ${last}`} · All day`;
  }
  return `${day(e.start, timeZone)} · ${time(e.start, timeZone)}`;
}
