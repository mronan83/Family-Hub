import ICAL from 'ical.js';

/**
 * [CAL-01][CAL-07] Reading a published calendar (SPIKE-02, `01` §5.4): what WP-22's sync builds on.
 * Pure functions over the ICS text; fetching and storing are the job's.
 */

/** A published iCloud link as Apple shares it (`webcal://`), as the https URL to fetch. */
export function icsUrl(raw: string): URL {
  const url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  if (url.protocol !== 'https:') throw new Error('calendar links must be https or webcal');
  return url;
}

export interface Instance {
  uid: string;
  title: string;
  allDay: boolean;
  /** Timed: the instant, ISO in UTC. All-day: the date, YYYY-MM-DD. */
  start: string;
  /** Exclusive, like DTEND: timed, the instant; all-day, the day after the last day. */
  end: string;
  /** The instance was moved or edited on its own (a RECURRENCE-ID override). */
  changed: boolean;
}

export interface Window {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, exclusive. */
  to: string;
  /** Where all-day dates and the window's edges are read. */
  timeZone: string;
}

/** Most instances one series may produce in a window, so a runaway rule cannot hang a job. */
const MAX_PER_SERIES = 2000;

function calendar(text: string): ICAL.Component {
  const comp = new ICAL.Component(ICAL.parse(text));
  // Times are only as right as their zones: register the calendar's own VTIMEZONE definitions.
  for (const tz of comp.getAllSubcomponents('vtimezone')) {
    ICAL.TimezoneService.register(tz);
  }
  return comp;
}

/** Midnight of a household-local date, as an instant. */
function localMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  // The zone's offset at that moment, from Intl (the offset can differ by an hour across DST).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess - (asLocal - guess));
}

function dateOf(t: ICAL.Time): string {
  return t.toString().slice(0, 10);
}

/**
 * Every instance that overlaps the window, in start order: recurring series expanded with their
 * exceptions (moved instances replace the original; EXDATEs and cancelled instances are left out),
 * timed events as UTC instants, all-day events as dates.
 */
export function expandIcs(text: string, window: Window): Instance[] {
  const comp = calendar(text);
  const from = localMidnight(window.from, window.timeZone).getTime();
  const to = localMidnight(window.to, window.timeZone).getTime();

  const masters = new Map<string, ICAL.Event>();
  const overrides: ICAL.Component[] = [];
  for (const vevent of comp.getAllSubcomponents('vevent')) {
    if (vevent.hasProperty('recurrence-id')) overrides.push(vevent);
    else masters.set(String(vevent.getFirstPropertyValue('uid')), new ICAL.Event(vevent));
  }
  for (const vevent of overrides) {
    const master = masters.get(String(vevent.getFirstPropertyValue('uid')));
    if (master) master.relateException(vevent);
  }

  const out: Instance[] = [];
  const push = (event: ICAL.Event, start: ICAL.Time, end: ICAL.Time, changed: boolean) => {
    if (String(event.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED')
      return;
    const allDay = start.isDate;
    let s: number;
    let e: number;
    let endDate = end;
    if (allDay) {
      // An all-day event without an end lasts its one day (RFC 5545 §3.6.1).
      if (end.compare(start) <= 0) {
        endDate = start.clone();
        endDate.adjust(1, 0, 0, 0);
      }
      s = localMidnight(dateOf(start), window.timeZone).getTime();
      e = localMidnight(dateOf(endDate), window.timeZone).getTime();
    } else {
      s = start.toJSDate().getTime();
      e = end.toJSDate().getTime();
    }
    if (e <= from || s >= to) return;
    out.push({
      uid: event.uid,
      title: event.summary ?? '',
      allDay,
      start: allDay ? dateOf(start) : new Date(s).toISOString(),
      end: allDay ? dateOf(endDate) : new Date(e).toISOString(),
      changed,
    });
  };

  for (const event of masters.values()) {
    if (!event.isRecurring()) {
      push(event, event.startDate, event.endDate, false);
      continue;
    }
    const it = event.iterator();
    for (let n = 0, next = it.next(); next && n < MAX_PER_SERIES; n++, next = it.next()) {
      const details = event.getOccurrenceDetails(next);
      if (details.startDate.toJSDate().getTime() >= to) break;
      push(details.item, details.startDate, details.endDate, details.item !== event);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid));
}

/** Properties that can carry personal details; fixtures keep a calendar's shape without them. */
const PERSONAL = [
  'description',
  'location',
  'url',
  'organizer',
  'attendee',
  'contact',
  'comment',
  'geo',
  'attach',
];

/**
 * A calendar with its structure kept (zones, rules, exceptions, all-day events) and its personal
 * details removed, for test fixtures: titles become "Event 1", "Event 2", … in the order the series
 * start, UIDs are replaced, and alarms and Apple's extra fields go.
 */
export function scrubIcs(text: string): string {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const name of ['x-wr-calname', 'x-wr-caldesc']) comp.removeAllProperties(name);
  comp.addPropertyWithValue('x-wr-calname', 'FamilyWise test');

  const vevents = comp.getAllSubcomponents('vevent');
  const firstStart = new Map<string, string>();
  for (const v of vevents) {
    const uid = String(v.getFirstPropertyValue('uid'));
    const start = String(v.getFirstPropertyValue('dtstart'));
    // A series is ordered by its own start; an override counts only if its series is missing.
    if (!v.hasProperty('recurrence-id') || !firstStart.has(uid)) firstStart.set(uid, start);
  }
  const order = [...firstStart.entries()].sort(
    (a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]),
  );
  const label = new Map(order.map(([uid], i) => [uid, i + 1]));

  for (const v of vevents) {
    const n = label.get(String(v.getFirstPropertyValue('uid')));
    for (const name of PERSONAL) v.removeAllProperties(name);
    // Copy first: removing from the live list while walking it would skip the next property.
    for (const p of [...v.getAllProperties()]) if (p.name.startsWith('x-')) v.removeProperty(p);
    v.removeAllSubcomponents('valarm');
    v.updatePropertyWithValue('uid', `event-${n}@familywise.test`);
    v.updatePropertyWithValue('summary', `Event ${n}`);
  }
  return comp.toString();
}
