import { describe, expect, it } from 'vitest';
import { type AlertFacts, homeAlerts, howLong } from './home-alerts';

const NOW = '2026-10-13T14:00:00.000Z';
const quiet: AlertFacts = {
  now: NOW,
  today: '2026-10-13',
  approvals: 0,
  requests: 0,
  boards: [{ name: 'Kitchen', lastSeenAt: '2026-10-13T13:58:00.000Z', revoked: false }],
  calendars: [{ name: 'Family', status: 'ok' }],
  menuFeeds: [{ name: 'Lunch', status: 'ok' }],
  jobsNeedingLook: 0,
  weather: { place: 'Springfield', failedAt: null },
  schoolYear: { name: '2026–27', startDate: '2026-09-02', endDate: '2027-06-18' },
  nextWeek: { school: true, menuDays: 5 },
  hasMenus: true,
  invites: [],
};
const keys = (f: Partial<AlertFacts>) => homeAlerts({ ...quiet, ...f }).map((a) => a.key);

describe('[NFR-17][US-109] Home alerts', () => {
  it('shows nothing when nothing needs a look', () => {
    expect(homeAlerts(quiet)).toEqual([]);
  });

  it('[MEAL-09] asks for a child’s lunch changes from the board, on Today (WP-49)', () => {
    expect(homeAlerts({ ...quiet, lunches: 1 })[0]).toMatchObject({
      key: 'lunches',
      level: 'act',
      text: '1 lunch change waits for you',
      href: '/admin/today',
    });
    expect(keys({ approvals: 1, lunches: 2, requests: 1 })).toEqual([
      'approvals',
      'lunches',
      'requests',
    ]);
  });

  it('asks for waiting check-offs and reward requests, with where to deal with them', () => {
    const [a, r] = homeAlerts({ ...quiet, approvals: 2, requests: 1 });
    expect(a).toMatchObject({
      level: 'act',
      text: '2 check-offs wait for you',
      href: '/admin/today',
    });
    expect(r).toMatchObject({
      level: 'act',
      text: '1 reward request waits for you',
      href: '/admin/rewards',
    });
  });

  it('gives a heads-up (not a "Needs you") for boards dark for a day, never a disconnected or new one', () => {
    const board = (name: string, lastSeenAt: string | null, revoked = false) => ({
      name,
      lastSeenAt,
      revoked,
    });
    // Asleep for hours, or never reported yet: nothing to say.
    expect(keys({ boards: [board('Kitchen', '2026-10-13T02:00:00.000Z')] })).toEqual([]);
    expect(keys({ boards: [board('Den', null)] })).toEqual([]);
    const [one] = homeAlerts({
      ...quiet,
      boards: [board('Kitchen', '2026-10-11T14:00:00.000Z'), board('Old', null, true)],
    });
    expect(one).toMatchObject({
      key: 'boards',
      level: 'note',
      text: 'Kitchen hasn’t been seen for 2 days',
    });
    // Several boards share one line.
    const [many] = homeAlerts({
      ...quiet,
      boards: [
        board('Kitchen', '2026-10-11T14:00:00.000Z'),
        board('Den', '2026-10-10T14:00:00.000Z'),
      ],
    });
    expect(many).toMatchObject({ key: 'boards', text: '2 boards haven’t been seen for a day' });
  });

  it('[DEV-07][US-207] WP-34: each board’s choice decides whether it is listed', () => {
    // NOW is 10 am in New York, a Tuesday; Kitchen sleeps 9:30 pm to 6:30 am on school nights.
    const times = {
      school: { sleep: 21 * 60 + 30, wake: 6 * 60 + 30 },
      weekend: { sleep: 22 * 60 + 30, wake: 7 * 60 + 30 },
    };
    const board = (missed: 'always' | 'awake' | 'never', lastSeenAt: string) => ({
      name: 'Kitchen',
      lastSeenAt,
      revoked: false,
      sleep: { missed, schedule: times, idleMinutes: null },
    });
    const at = (f: Partial<AlertFacts>) =>
      keys({ ...f, timeZone: 'America/New_York', schoolDays: null });
    // Unseen 25 hours: Always lists it; Only while awake counts 16 hours awake, not yet; Never doesn't.
    const yesterday = '2026-10-12T13:00:00.000Z';
    expect(at({ boards: [board('always', yesterday)] })).toEqual(['boards']);
    expect(at({ boards: [board('awake', yesterday)] })).toEqual([]);
    expect(at({ boards: [board('never', yesterday)] })).toEqual([]);
    // Unseen a week: listed while awake (10 am), but not while asleep (11 pm), and Never never.
    const lastWeek = '2026-10-06T13:00:00.000Z';
    expect(at({ boards: [board('awake', lastWeek)] })).toEqual(['boards']);
    expect(at({ boards: [board('awake', lastWeek)], now: '2026-10-14T03:00:00.000Z' })).toEqual([]);
    expect(at({ boards: [board('never', lastWeek)] })).toEqual([]);
  });

  it('names a calendar or menu that fails, and counts background jobs', () => {
    const texts = homeAlerts({
      ...quiet,
      calendars: [{ name: 'School', status: 'error' }],
      menuFeeds: [
        { name: 'Lunch', status: 'error' },
        { name: 'Breakfast', status: 'error' },
      ],
      jobsNeedingLook: 1,
    }).map((a) => a.text);
    expect(texts).toEqual([
      'School can’t sync',
      '2 school menus can’t be read',
      '1 background job needs a look',
    ]);
  });

  it('gives a heads-up for next week with no menu, only when there is school and menus are kept', () => {
    expect(keys({ nextWeek: { school: true, menuDays: 0 } })).toEqual(['menu-next-week']);
    expect(keys({ nextWeek: { school: false, menuDays: 0 } })).toEqual([]);
    expect(keys({ nextWeek: { school: true, menuDays: 0 }, hasMenus: false })).toEqual([]);
  });

  it('notes no school year, and a school year ending within two weeks', () => {
    expect(keys({ schoolYear: null })).toEqual(['school-none']);
    expect(homeAlerts({ ...quiet, today: '2027-06-08' })[0]).toMatchObject({
      level: 'note',
      text: '2026–27 ends Jun 18; is next year set up?',
    });
  });

  it('notes weather that stopped updating, and an invite about to run out', () => {
    const alerts = homeAlerts({
      ...quiet,
      weather: { place: 'Springfield', failedAt: '2026-10-13T12:00:00.000Z' },
      invites: [
        { email: 'sam@example.com', expiresAt: '2026-10-14T14:00:00.000Z' },
        { email: 'pat@example.com', expiresAt: '2026-10-19T14:00:00.000Z' },
      ],
    });
    expect(alerts.map((a) => a.text)).toEqual([
      'The weather hasn’t updated for 2 hours',
      'sam@example.com’s invite runs out in 24 hours',
    ]);
  });

  it('puts what needs you before heads-ups', () => {
    const levels = homeAlerts({ ...quiet, schoolYear: null, approvals: 1 }).map((a) => a.level);
    expect(levels).toEqual(['act', 'note']);
  });

  it('says how long in words', () => {
    expect([howLong(0.2), howLong(20), howLong(180), howLong(3 * 1440)]).toEqual([
      '1 minute',
      '20 minutes',
      '3 hours',
      '3 days',
    ]);
  });
});
