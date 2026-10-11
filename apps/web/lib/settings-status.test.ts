import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, navCurrent, SETTINGS_HREF, SETTINGS_PAGES, settingsPage } from './admin-nav';
import {
  boardsStatus,
  calendarsStatus,
  healthStatus,
  remindersStatus,
  schoolStatus,
  tagsStatus,
} from './settings-status';

describe('the admin menu', () => {
  it('[NFR-15][US-107] three groups; Settings holds the set-up pages, Tags among them', () => {
    expect(NAV_GROUPS.map((g) => g.label)).toEqual(['Your day', 'The family', 'Set-up']);
    expect(NAV_GROUPS.flatMap((g) => g.pages.map((p) => p.label))).toEqual([
      'Home',
      'Today',
      'My tasks',
      'Chores',
      'Members',
      'Rewards',
      'Goals',
      'Meals',
      'Insights',
      'Settings',
    ]);
    expect(SETTINGS_PAGES.map((p) => p.label)).toEqual([
      'School',
      'Calendars',
      'Boards',
      'Tags',
      'Reminders',
      'Health',
    ]);
  });

  it('[NFR-15] a page Settings holds marks Settings, with its way back; any other marks itself', () => {
    expect(navCurrent('/admin/tags')).toBe(SETTINGS_HREF);
    expect(settingsPage('/admin/devices')?.label).toBe('Boards');
    expect(navCurrent('/admin/meals')).toBe('/admin/meals');
    expect(settingsPage('/admin/meals')).toBeNull();
    expect(settingsPage(SETTINGS_HREF)).toBeNull();
  });
});

describe('Settings, how each part stands', () => {
  const year = (name: string, startDate: string, endDate: string, isDefault = true) => ({
    name,
    startDate,
    endDate,
    isDefault,
    archived: false,
  });

  it('[SCH-01] the school year today is in, else the next, else a nudge', () => {
    const years = [
      year('2025–26', '2025-08-20', '2026-06-12'),
      year('2026–27', '2026-08-19', '2027-06-18'),
    ];
    expect(schoolStatus(years, '2026-10-11')).toEqual({
      text: '2026–27 · ends Jun 18',
      warn: false,
    });
    expect(schoolStatus(years, '2026-07-01')).toEqual({
      text: '2026–27 · starts Aug 19',
      warn: false,
    });
    expect(schoolStatus([], '2026-10-11')).toEqual({ text: 'No school year yet', warn: true });
    // The household's own year first, when two cover today.
    expect(
      schoolStatus(
        [
          year('Leo’s', '2026-08-01', '2027-06-01', false),
          year('2026–27', '2026-08-19', '2027-06-18'),
        ],
        '2026-10-11',
      ).text,
    ).toBe('2026–27 · ends Jun 18');
  });

  it('[CAL-06] how many calendars, or which can’t sync', () => {
    expect(calendarsStatus([])).toEqual({ text: 'None yet', warn: false });
    expect(calendarsStatus([{ name: 'Family', status: 'ok' }])).toEqual({
      text: '1 calendar',
      warn: false,
    });
    expect(
      calendarsStatus([
        { name: 'Family', status: 'ok' },
        { name: 'School', status: 'error' },
      ]),
    ).toEqual({ text: 'School can’t sync', warn: true });
    expect(
      calendarsStatus([
        { name: 'Family', status: 'error' },
        { name: 'School', status: 'error' },
      ]).text,
    ).toBe('2 calendars can’t sync');
  });

  it('[DEV-04][CHR-10][CHR-15][NFR-07] boards, tags, reminders and health', () => {
    expect(
      boardsStatus([
        { name: 'Kitchen', revoked: false },
        { name: 'Old', revoked: true },
      ]).text,
    ).toBe('Kitchen');
    expect(
      boardsStatus([
        { name: 'Kitchen', revoked: false },
        { name: 'Hall', revoked: false },
      ]).text,
    ).toBe('2 boards');
    expect(boardsStatus([]).text).toBe('No boards yet');
    expect(tagsStatus([{ archived: false }, { archived: true }]).text).toBe('1 tag');
    expect(tagsStatus([]).text).toBe('No tags yet');
    expect(
      remindersStatus(true, true, [{ enabled: true }, { enabled: true }, { enabled: false }]).text,
    ).toBe('On for 2 devices');
    expect(remindersStatus(true, true, [])).toEqual({
      text: 'On, but no device gets them',
      warn: true,
    });
    expect(remindersStatus(false, false, []).text).toBe('Off');
    expect(healthStatus(0, 0)).toEqual({ text: 'Everything is running', warn: false });
    expect(healthStatus(1, 1)).toEqual({ text: '2 things to look at', warn: true });
  });
});
