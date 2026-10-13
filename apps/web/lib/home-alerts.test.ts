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

  it('misses a board once it is quiet for 15 minutes, never a disconnected one', () => {
    expect(
      keys({
        boards: [{ name: 'Kitchen', lastSeenAt: '2026-10-13T13:46:00.000Z', revoked: false }],
      }),
    ).toEqual([]);
    const [b] = homeAlerts({
      ...quiet,
      boards: [
        { name: 'Kitchen', lastSeenAt: '2026-10-13T11:00:00.000Z', revoked: false },
        { name: 'Old', lastSeenAt: null, revoked: true },
      ],
    });
    expect(b).toMatchObject({ key: 'board:Kitchen', text: 'Kitchen hasn’t been seen for 3 hours' });
    expect(keys({ boards: [{ name: 'Den', lastSeenAt: null, revoked: false }] })).toEqual([
      'board:Den',
    ]);
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
