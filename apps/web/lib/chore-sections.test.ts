import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  byHeading,
  comingUpLine,
  completedCount,
  doAgainDates,
  duplicateOf,
  filtersHref,
  headingFor,
  lastWeekLine,
  moreFiltersLine,
  moreOptionsLine,
  type OnceOccurrence,
  parseChoreFilters,
  place,
  rowParts,
  sections,
  type SectionItem,
  togglePerson,
} from './chore-sections';
import { clock, describeSchedule, relativeDay, type ChoreInput, type Schedule } from './chores';

const TZ = 'America/Chicago';
const MAYA = 'c5100000-0000-4000-8000-000000000001';
const LEO = 'c5100000-0000-4000-8000-000000000002';
const SAM = 'c5100000-0000-4000-8000-000000000004';
const KITCHEN = 'c5700000-0000-4000-8000-000000000001';

let n = 0;
type Item = SectionItem & { points: number };
function item(title: string, schedule: Schedule, extra: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `c5400000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    title,
    kind: 'chore',
    dueTime: null,
    assignees: [MAYA],
    tags: [],
    archivedAt: null,
    schedule,
    assignment: 'shared',
    points: 0,
    ...extra,
  };
}
const once = (on_date: string): Schedule => ({ freq: 'once', on_date });
const occ = (
  c: Item,
  status: string,
  memberId: string | null = null,
  changedAt: string | null = null,
): OnceOccurrence => ({
  choreId: c.id,
  dueDate: (c.schedule as { on_date: string }).on_date,
  memberId,
  status,
  changedAt,
});
const sectionOf = (c: Item, os: OnceOccurrence[], today = '2026-10-14') =>
  place([c], os, today, 0, TZ)[0]!;

describe('[CHR-21-a] which section an item is in', () => {
  it('[CHR-21-a] a one-time item not done is Scheduled; done, it is Completed', () => {
    const c = item('Wash the car', once('2026-10-17'));
    expect(sectionOf(c, [occ(c, 'scheduled')]).section).toBe('scheduled');
    expect(sectionOf(c, [occ(c, 'pending_approval')]).section).toBe('scheduled');
    const done = sectionOf(c, [occ(c, 'approved', null, '2026-10-17T15:00:00Z')]);
    expect(done).toMatchObject({ section: 'completed', outcome: 'done', finishedOn: '2026-10-17' });
  });

  it('[CHR-21-a] a one-time chore missed is Completed and marked missed; a task stays Scheduled, overdue', () => {
    const chore = item('Practise for the recital', once('2026-10-10'));
    expect(sectionOf(chore, [occ(chore, 'missed', null, '2026-10-11T05:05:00Z')])).toMatchObject({
      section: 'completed',
      outcome: 'missed',
      finishedOn: '2026-10-11',
    });
    const task = item('Book the dentist', once('2026-10-12'), { kind: 'task' });
    expect(sectionOf(task, [occ(task, 'scheduled')])).toMatchObject({
      section: 'scheduled',
      heading: 'overdue',
    });
  });

  it('[CHR-21-a] each their own: Scheduled with "1 of 2 done" until everyone has done theirs', () => {
    const c = item('Wash the car', once('2026-10-17'), {
      assignees: [MAYA, LEO],
      assignment: 'each',
    });
    const part = sectionOf(c, [
      occ(c, 'completed', MAYA, '2026-10-17T15:00:00Z'),
      occ(c, 'scheduled', LEO),
    ]);
    expect(part).toMatchObject({ section: 'scheduled', progress: { done: 1, of: 2 } });
    const all = sectionOf(c, [
      occ(c, 'completed', MAYA, '2026-10-17T15:00:00Z'),
      occ(c, 'completed', LEO, '2026-10-17T16:00:00Z'),
    ]);
    expect(all).toMatchObject({ section: 'completed', outcome: 'done' });
  });

  it('[CHR-21-a] a recurring item is never completed; anything archived is Archived; one not planned yet is Scheduled', () => {
    const daily = item('Make bed', { freq: 'daily' });
    expect(sectionOf(daily, []).section).toBe('recurring');
    const gone = item(
      'Swim bag ready',
      { freq: 'weekly', by_weekday: [1] },
      {
        archivedAt: '2026-09-14T15:00:00Z',
      },
    );
    expect(sectionOf(gone, []).section).toBe('archived');
    const archivedOnce = item('Sell the old bike', once('2026-08-30'), {
      archivedAt: '2026-09-01T15:00:00Z',
    });
    expect(sectionOf(archivedOnce, [occ(archivedOnce, 'completed')]).section).toBe('archived');
    const later = item('Carve the pumpkins', once('2026-10-31'));
    expect(sectionOf(later, [])).toMatchObject({ section: 'scheduled', heading: 'later' });
  });

  it('[CHR-21-a] only the occurrences on its own date count, so a date moved later is Scheduled again', () => {
    const c = item('Renew the passports', once('2026-11-09'), { kind: 'task' });
    expect(sectionOf(c, [{ ...occ(c, 'completed'), dueDate: '2026-10-01' }]).section).toBe(
      'scheduled',
    );
  });
});

describe('[CHR-21-b] Scheduled’s date headings', () => {
  it('[CHR-21-b] Overdue, Today, This week to the week’s last day, then Later', () => {
    expect(headingFor('2026-10-13', '2026-10-14', 0)).toBe('overdue');
    expect(headingFor('2026-10-14', '2026-10-14', 0)).toBe('today');
    expect(headingFor('2026-10-17', '2026-10-14', 0)).toBe('week');
    expect(headingFor('2026-10-18', '2026-10-14', 0)).toBe('later');
  });

  it('[CHR-21-b] the week ends where the household’s week does', () => {
    // A Monday start: Sunday Oct 18 is still this week.
    expect(headingFor('2026-10-18', '2026-10-14', 1)).toBe('week');
    expect(headingFor('2026-10-19', '2026-10-14', 1)).toBe('later');
    // On the week's last day, the next day is Later.
    expect(headingFor('2026-10-18', '2026-10-17', 0)).toBe('later');
  });

  it('[CHR-21-b] across midnight UTC the household’s own date decides the day it was done', () => {
    const c = item('Sign the form', once('2026-10-13'), { kind: 'task' });
    // 03:30 UTC on the 14th is 10:30 pm on the 13th in Chicago.
    expect(sectionOf(c, [occ(c, 'completed', null, '2026-10-14T03:30:00Z')]).finishedOn).toBe(
      '2026-10-13',
    );
  });

  it('[CHR-21-b] across the end of DST the dates stay calendar dates', () => {
    // DST ends at 2 am on Sun Nov 1, 2026 in Chicago; the week (from Sunday) starts that day.
    expect(headingFor('2026-11-01', '2026-10-31', 0)).toBe('later');
    expect(headingFor('2026-11-07', '2026-11-01', 0)).toBe('week');
    expect(headingFor('2026-11-08', '2026-11-01', 0)).toBe('later');
    const c = item('Rake the leaves', once('2026-11-01'));
    // 05:30 UTC on Nov 2 is 11:30 pm on Nov 1, after the clocks went back.
    expect(
      sectionOf(c, [occ(c, 'completed', null, '2026-11-02T05:30:00Z')], '2026-11-02').finishedOn,
    ).toBe('2026-11-01');
  });

  it('[CHR-21-b] headings in order, leaving out one with nothing under it', () => {
    const a = item('A', once('2026-10-20'));
    const b = item('B', once('2026-10-12'));
    const groups = byHeading(sections(place([a, b], [], '2026-10-14', 0, TZ)).scheduled);
    expect(groups.map((g) => g.heading)).toEqual(['overdue', 'later']);
  });
});

describe('[CHR-21-c] the order inside each section', () => {
  it('[CHR-21-c] Scheduled by date then time; Recurring by time of day then name', () => {
    const items = [
      item('Later in the day', once('2026-10-16'), { dueTime: '18:00' }),
      item('Early', once('2026-10-16'), { dueTime: '07:00' }),
      item('Before', once('2026-10-15')),
      item('Water the plants', { freq: 'daily' }),
      item('Set the table', { freq: 'daily' }, { dueTime: '18:00' }),
      item('Homework', { freq: 'daily' }, { dueTime: '16:00' }),
      item('Brush teeth', { freq: 'daily' }, { dueTime: '07:45' }),
      item('Make bed', { freq: 'daily' }, { dueTime: '07:45' }),
    ];
    const s = sections(place(items, [], '2026-10-14', 0, TZ));
    expect(s.scheduled.map((p) => p.item.title)).toEqual(['Before', 'Early', 'Later in the day']);
    expect(s.recurring.map((p) => p.item.title)).toEqual([
      'Brush teeth',
      'Make bed',
      'Homework',
      'Set the table',
      'Water the plants',
    ]);
  });

  it('[CHR-21-c] Completed newest done first; Archived newest archived first', () => {
    const a = item('Old', once('2026-10-01'));
    const b = item('New', once('2026-10-03'));
    const x = item('Archived long ago', { freq: 'daily' }, { archivedAt: '2026-08-01T00:00:00Z' });
    const y = item('Archived lately', { freq: 'daily' }, { archivedAt: '2026-10-01T00:00:00Z' });
    const s = sections(
      place(
        [a, b, x, y],
        [
          occ(a, 'completed', null, '2026-10-05T15:00:00Z'),
          occ(b, 'completed', null, '2026-10-03T15:00:00Z'),
        ],
        '2026-10-14',
        0,
        TZ,
      ),
    );
    expect(s.completed.map((p) => p.item.title)).toEqual(['Old', 'New']);
    expect(s.archived.map((p) => p.item.title)).toEqual(['Archived lately', 'Archived long ago']);
  });
});

describe('[CHR-21-d] the person chips', () => {
  const items = [
    item('Maya’s', { freq: 'daily' }, { assignees: [MAYA] }),
    item('Leo’s', once('2026-10-15'), { assignees: [LEO] }),
    item('Both', once('2026-10-01'), { assignees: [MAYA, LEO] }),
    item('Sam’s', { freq: 'daily' }, { assignees: [SAM], archivedAt: '2026-10-01T00:00:00Z' }),
  ];
  it('[CHR-21-d] a face filters every section at once; several show what is any of theirs', () => {
    const f = parseChoreFilters({ who: MAYA });
    const s = sections(place(applyFilters(items, f), [], '2026-10-14', 0, TZ));
    expect([...s.recurring, ...s.scheduled, ...s.archived].map((p) => p.item.title)).toEqual([
      'Maya’s',
      'Both',
    ]);
    const two = applyFilters(items, togglePerson(f, LEO)).map((i) => i.title);
    expect(two).toEqual(['Maya’s', 'Leo’s', 'Both']);
    expect(applyFilters(items, parseChoreFilters({ who: SAM })).map((i) => i.title)).toEqual([
      'Sam’s',
    ]);
  });

  it('[CHR-21-d] a chosen face tapped again comes off; Clear is the page without them', () => {
    const f = parseChoreFilters({ who: `${MAYA},${LEO}`, kind: 'chore' });
    expect(f.people).toEqual([MAYA, LEO]);
    expect(filtersHref(togglePerson(f, MAYA))).toBe(`/admin/chores?who=${LEO}&kind=chore`);
    expect(filtersHref({ ...f, people: [] })).toBe('/admin/chores?kind=chore');
    expect(filtersHref(parseChoreFilters({}))).toBe('/admin/chores');
  });

  it('[CHR-21-d] anything unknown in the address is ignored, and the old person link still works', () => {
    expect(parseChoreFilters({ who: 'nobody,<x>', kind: 'meal', when: 'noon' })).toEqual({
      people: [],
      tag: null,
      kind: null,
      when: null,
    });
    expect(parseChoreFilters({ person: MAYA }).people).toEqual([MAYA]);
  });
});

describe('[CHR-21-e] More filters folded', () => {
  const tagName = () => 'Kitchen';
  it('[CHR-21-e] reads the defaults when nothing is set', () => {
    expect(moreFiltersLine(parseChoreFilters({}), tagName, 23, 23)).toEqual([
      'Any tag · Chores and tasks · Any time',
    ]);
  });
  it('[CHR-21-e] reads what is set and how many show, so a filtered page reads as filtered', () => {
    expect(moreFiltersLine(parseChoreFilters({ tag: KITCHEN }), tagName, 4, 23)).toEqual([
      { b: 'Tag: Kitchen' },
      ' · 4 of 23 show',
    ]);
    expect(
      moreFiltersLine(parseChoreFilters({ kind: 'chore', when: 'morning' }), tagName, 1, 23),
    ).toEqual([{ b: 'Kind: Chores · Time of day: Morning' }, ' · 1 of 23 shows']);
  });
  it('[CHR-21-e] the tag, kind and time of day filter the items', () => {
    const items = [
      item('Kitchen chore', { freq: 'daily' }, { tags: [KITCHEN], dueTime: '07:00' }),
      item('Kitchen task', { freq: 'daily' }, { tags: [KITCHEN], kind: 'task' }),
      item('Bedroom', { freq: 'daily' }),
    ];
    expect(applyFilters(items, parseChoreFilters({ tag: KITCHEN })).map((i) => i.title)).toEqual([
      'Kitchen chore',
      'Kitchen task',
    ]);
    expect(
      applyFilters(items, parseChoreFilters({ tag: KITCHEN, kind: 'task' })).map((i) => i.title),
    ).toEqual(['Kitchen task']);
    expect(applyFilters(items, parseChoreFilters({ when: 'morning' })).map((i) => i.title)).toEqual(
      ['Kitchen chore'],
    );
  });
});

describe('[CHR-21-f] Completed’s count and each row’s second line', () => {
  const ctx = {
    today: '2026-10-14',
    timeZone: TZ,
    who: 'Maya, Leo',
    describe: describeSchedule,
    clock,
  };
  it('[CHR-21-f] Completed counts the done ones and says how many were missed', () => {
    const a = item('A', once('2026-10-01'));
    const b = item('B', once('2026-10-02'));
    const placed = place([a, b], [occ(a, 'completed'), occ(b, 'missed')], '2026-10-14', 0, TZ);
    expect(completedCount(placed)).toBe('1 done · 1 missed');
    expect(completedCount(placed.slice(0, 1))).toBe('1 done');
  });
  it('[CHR-21-f] Scheduled: its date, time, who, "1 of 2 done" and points; overdue in the missed colour', () => {
    const car = item('Wash the car', once('2026-10-17'), {
      dueTime: '10:00',
      points: 15,
      assignees: [MAYA, LEO],
      assignment: 'each',
    });
    const p = place(
      [car],
      [occ(car, 'completed', MAYA), occ(car, 'scheduled', LEO)],
      '2026-10-14',
      0,
      TZ,
    )[0]!;
    expect(rowParts(p, ctx)).toEqual([
      { text: 'Once, Sat, Oct 17' },
      { text: '10:00 am' },
      { text: 'Maya, Leo' },
      { text: '1 of 2 done' },
      { text: '+15', tone: 'pts' },
    ]);
    const late = item('Book the dentist', once('2026-10-12'), { kind: 'task' });
    expect(rowParts(place([late], [], '2026-10-14', 0, TZ)[0]!, { ...ctx, who: 'Alex' })).toEqual([
      { text: 'Due Mon, Oct 12', tone: 'late' },
      { text: 'Alex' },
    ]);
    const today = item('Pay the fee', once('2026-10-14'), { kind: 'task' });
    expect(
      rowParts(place([today], [], '2026-10-14', 0, TZ)[0]!, { ...ctx, who: 'Sam' })[0],
    ).toEqual({
      text: 'Due today',
    });
  });
  it('[CHR-21-f] Recurring leads with a task’s "Overdue since"; Completed with done or missed; Archived ends with when', () => {
    const filter = item(
      'Change the furnace filter',
      { freq: 'monthly', by_month_day: [1] },
      {
        kind: 'task',
      },
    );
    expect(
      rowParts(place([filter], [], '2026-10-14', 0, TZ)[0]!, {
        ...ctx,
        who: 'Alex',
        overdueSince: '2026-10-01',
      }),
    ).toEqual([
      { text: 'Overdue since Thu, Oct 1', tone: 'late' },
      { text: 'Monthly on the 1st' },
      { text: 'Alex' },
    ]);
    const missed = item('Practise', once('2026-10-10'), { points: 10 });
    expect(
      rowParts(
        place(
          [missed],
          [occ(missed, 'missed', null, '2026-10-11T05:05:00Z')],
          '2026-10-14',
          0,
          TZ,
        )[0]!,
        {
          ...ctx,
          who: 'Maya',
        },
      ),
    ).toEqual([
      { text: 'Missed Sun, Oct 11', tone: 'late' },
      { text: 'Maya' },
      { text: '+10', tone: 'pts' },
    ]);
    const gone = item(
      'Recorder practice',
      { freq: 'daily' },
      { archivedAt: '2026-10-02T15:00:00Z' },
    );
    expect(rowParts(place([gone], [], '2026-10-14', 0, TZ)[0]!, { ...ctx, who: 'Leo' })).toEqual([
      { text: 'Every day' },
      { text: 'Leo' },
      { text: 'Archived Oct 2' },
    ]);
  });
});

const homework: ChoreInput = {
  kind: 'chore',
  title: 'Homework',
  icon: 'chore-homework',
  assignees: [MAYA, LEO],
  schedule: { freq: 'weekly', by_weekday: [1, 2, 3, 4, 5] },
  dueTime: '16:00',
  dayTypes: ['school_day'],
  points: 10,
  approval: 'inherit',
  assignment: 'each',
  lunchDays: null,
  tags: [KITCHEN],
  visibility: 'family',
  remindLeadMinutes: 15,
  opens: null,
};

describe('[CHR-22-a] Duplicate’s filled form', () => {
  it('[CHR-22-a] every field from the original, its name marked "(copy)"', () => {
    const copy = duplicateOf(homework);
    expect(copy).toEqual({ ...homework, title: 'Homework (copy)' });
    // A copy of the lists, so changing the form never changes the original.
    expect(copy.assignees).not.toBe(homework.assignees);
    expect(copy.tags).not.toBe(homework.tags);
  });
  it('[CHR-22-a] a long name is cut so the copy still fits 80 characters', () => {
    const long = duplicateOf({ ...homework, title: 'x'.repeat(80) });
    expect(long.title).toHaveLength(80);
    expect(long.title.endsWith(' (copy)')).toBe(true);
  });
});

describe('[CHR-23-a] Do again', () => {
  it('[CHR-23-a] its quick dates: Tomorrow, the next Saturday, In a week', () => {
    // Wed Oct 14: Thu 15, Sat 17, Wed 21.
    expect(doAgainDates('2026-10-14')).toEqual([
      { label: 'Tomorrow', date: '2026-10-15' },
      { label: 'Sat, Oct 17', date: '2026-10-17' },
      { label: 'In a week', date: '2026-10-21' },
    ]);
  });
  it('[CHR-23-a] across a week’s end a date already offered is offered once', () => {
    // Fri Oct 16: tomorrow is Saturday, so the next Saturday is the one after.
    expect(doAgainDates('2026-10-16').map((d) => d.date)).toEqual([
      '2026-10-17',
      '2026-10-24',
      '2026-10-23',
    ]);
    // Sat Oct 17: the next Saturday is in a week.
    expect(doAgainDates('2026-10-17')).toEqual([
      { label: 'Tomorrow', date: '2026-10-18' },
      { label: 'In a week', date: '2026-10-24' },
    ]);
    // Across the end of DST and a month's end.
    expect(doAgainDates('2026-10-31').map((d) => d.date)).toEqual(['2026-11-01', '2026-11-07']);
  });
  it('[CHR-23-a] Change more first fills the form as a one-time item on that date, under its own name', () => {
    const again = duplicateOf(
      { ...homework, schedule: { freq: 'once', on_date: '2026-10-11' } },
      '2026-10-17',
    );
    expect(again).toMatchObject({
      title: 'Homework',
      schedule: { freq: 'once', on_date: '2026-10-17' },
      assignees: [MAYA, LEO],
      points: 10,
      dueTime: '16:00',
    });
  });
});

describe('[NFR-18-y] an item’s page folded', () => {
  const label = (d: string) => d;
  it('[NFR-18-y] More options reads how it is set: approval, days and lunch', () => {
    expect(
      moreOptionsLine(
        {
          approval: 'inherit',
          dayTypes: ['school_day', 'no_school', 'break', 'weekend', 'summer'],
          lunchDays: null,
        },
        'off',
        label,
        label,
      ),
    ).toBe('Approval: family setting (off) · every kind of day · any lunch day');
    expect(
      moreOptionsLine(
        { approval: 'required', dayTypes: ['School days'], lunchDays: 'Days they bring lunch' },
        'on',
        label,
        label,
      ),
    ).toBe('Always needs a parent’s OK · School days only · on days they bring lunch');
  });
  it('[NFR-18-y] Coming up reads the next one, when and who, and how many in two weeks', () => {
    const days = [
      { dueDate: '2026-10-15', members: [MAYA] },
      { dueDate: '2026-10-16', members: [MAYA] },
    ];
    expect(
      comingUpLine(days, {
        today: '2026-10-14',
        time: '7:45 am',
        name: () => 'Maya',
        relative: relativeDay,
      }),
    ).toEqual([{ b: 'Next:' }, ' tomorrow 7:45 am, Maya · 2 in the next two weeks']);
    expect(
      comingUpLine([], { today: '2026-10-14', time: null, name: () => '', relative: relativeDay }),
    ).toEqual(['Nothing in the next two weeks']);
  });
  it('[NFR-18-y] Last 7 days reads how many done, missed and skipped', () => {
    const days = ['completed', 'approved', 'missed', 'skipped', 'completed'].map((status) => ({
      occurrences: [{ status }],
    }));
    expect(lastWeekLine(days, 'chore')).toEqual([{ b: '3 done' }, ' · 1 missed · 1 skipped']);
    expect(lastWeekLine([{ occurrences: [{ status: 'scheduled' }] }], 'task')).toEqual([
      { b: '0 done' },
      ' · 1 left open',
    ]);
    expect(lastWeekLine([], 'chore')).toEqual(['Nothing was due']);
  });
});
