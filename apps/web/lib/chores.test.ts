import { describe, expect, it } from 'vitest';
import {
  choreSaveMessage,
  chorePayload,
  clock,
  dayPart,
  describeSchedule,
  dueSummary,
  filterItems,
  parseChore,
  parseFilters,
  defaultAssignment,
  historyLine,
  relativeDay,
  scheduleSchema,
  type ListItem,
} from './chores';

const MAYA = 'f1000000-0000-4000-8000-000000000001';
const ALEX = 'f2000000-0000-4000-8000-000000000002';
const KITCHEN = 'a1000000-0000-4000-8000-000000000001';

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    for (const one of Array.isArray(v) ? v : [v]) f.append(k, one);
  }
  return f;
}

const ALL_DAYS = ['school_day', 'no_school', 'break', 'weekend', 'summer'];
const base = {
  kind: 'chore',
  title: ' Make bed ',
  icon: 'chore-bed',
  assignees: [MAYA, ALEX],
  freq: 'daily',
  dueTime: '07:30',
  dayTypes: ALL_DAYS,
  points: '5',
  approval: 'inherit',
  tags: [KITCHEN],
};

describe('scheduleSchema', () => {
  it('[CHR-01] accepts the four frequencies with only the keys each uses', () => {
    for (const s of [
      { freq: 'daily' },
      { freq: 'daily', interval: 2 },
      { freq: 'weekly', by_weekday: [1, 3, 5] },
      { freq: 'monthly', by_month_day: [1, 15] },
      { freq: 'once', on_date: '2026-11-02' },
    ]) {
      expect(scheduleSchema.safeParse(s).success, JSON.stringify(s)).toBe(true);
    }
  });

  it('[CHR-01] refuses what the database refuses (private.valid_schedule)', () => {
    for (const s of [
      { freq: 'hourly' },
      { freq: 'weekly' },
      { freq: 'weekly', by_weekday: [] },
      { freq: 'weekly', by_weekday: [0] },
      { freq: 'weekly', by_weekday: [1, 1] },
      { freq: 'monthly', by_month_day: [32] },
      { freq: 'once', on_date: '2026-02-30' },
      { freq: 'once' },
      { freq: 'daily', by_weekday: [1] },
      { freq: 'daily', interval: 0 },
      { freq: 'daily', interval: 1.5 },
      [],
      { freq: 'once', on_date: '2026-11-02', x: 1 },
    ]) {
      expect(scheduleSchema.safeParse(s).success, JSON.stringify(s)).toBe(false);
    }
  });
});

describe('parseChore', () => {
  it('[CHR-01][CHR-09][CHR-11] reads a chore for two people with a due time and a tag', () => {
    const parsed = parseChore(form(base), { canSetVisibility: true });
    expect(parsed).toEqual({
      ok: true,
      value: {
        kind: 'chore',
        title: 'Make bed',
        icon: 'chore-bed',
        assignees: [MAYA, ALEX],
        schedule: { freq: 'daily' },
        dueTime: '07:30',
        dayTypes: ALL_DAYS,
        points: 5,
        approval: 'inherit',
        assignment: 'each',
        tags: [KITCHEN],
        remindLeadMinutes: null,
        visibility: 'family',
      },
    });
  });

  it('[CHR-16] reads its reminder lead time, or none to follow each person’s own (WP-40)', () => {
    const lead = (value: string) => {
      const parsed = parseChore(form({ ...base, remindLeadMinutes: value }), {
        canSetVisibility: true,
      });
      return parsed.ok ? parsed.value.remindLeadMinutes : parsed.message;
    };
    expect(lead('')).toBeNull();
    expect(lead('0')).toBe(0);
    expect(lead('1440')).toBe(1440);
    expect(lead('30')).toBe('Choose when it reminds.');
  });

  it('[CHR-18] reads the choice for several people, and falls back to the kind’s default', () => {
    const read = (fields: Record<string, string | string[]>) => {
      const parsed = parseChore(form({ ...base, ...fields }), { canSetVisibility: true });
      return parsed.ok ? parsed.value.assignment : null;
    };
    expect(read({ assignment: 'shared' })).toBe('shared');
    expect(read({ assignment: 'each' })).toBe('each');
    expect(read({ assignment: 'nonsense' })).toBe('each');
    expect(read({ kind: 'task', freq: 'once', onDate: '2026-11-20' })).toBe('shared');
  });

  it('[CHR-01][CHR-13] reads a private one-off task with no time and no points', () => {
    const parsed = parseChore(
      form({
        ...base,
        kind: 'task',
        title: 'Buy anniversary gift',
        icon: 'gift',
        assignees: [ALEX],
        freq: 'once',
        onDate: '2026-11-20',
        dueTime: '',
        points: '',
        tags: [],
        private: 'on',
      }),
      { canSetVisibility: true },
    );
    expect(parsed.ok && parsed.value).toMatchObject({
      kind: 'task',
      schedule: { freq: 'once', on_date: '2026-11-20' },
      dueTime: null,
      points: 0,
      visibility: 'private',
    });
  });

  it('[CHR-13] leaves visibility out when the form does not offer it', () => {
    const parsed = parseChore(form({ ...base, private: 'on' }), { canSetVisibility: false });
    expect(parsed.ok && 'visibility' in parsed.value).toBe(false);
  });

  it('[CHR-01] reads weekly and monthly schedules', () => {
    const weekly = parseChore(form({ ...base, freq: 'weekly', weekdays: ['5', '1', '3'] }), {
      canSetVisibility: true,
    });
    expect(weekly.ok && weekly.value.schedule).toEqual({ freq: 'weekly', by_weekday: [1, 3, 5] });
    const monthly = parseChore(form({ ...base, freq: 'monthly', monthDay: '15' }), {
      canSetVisibility: true,
    });
    expect(monthly.ok && monthly.value.schedule).toEqual({ freq: 'monthly', by_month_day: [15] });
  });

  it('[CHR-01][CHR-09] says what to fix, one thing at a time', () => {
    const cases: [Record<string, string | string[]>, string][] = [
      [{ kind: 'routine' }, 'Choose chore or task.'],
      [{ title: '   ' }, 'Give it a name of up to 80 characters.'],
      [{ title: 'x'.repeat(81) }, 'Give it a name of up to 80 characters.'],
      [{ icon: 'not-an-icon' }, 'Choose an icon.'],
      [{ assignees: [] }, 'Choose who it’s for.'],
      [{ assignees: ['not-a-uuid'] }, 'Choose who it’s for.'],
      [{ freq: '' }, 'Choose how often it happens.'],
      [{ freq: 'weekly' }, 'Choose at least one day of the week.'],
      [{ freq: 'weekly', weekdays: ['8'] }, 'Check the schedule: that date or day isn’t valid.'],
      [{ freq: 'monthly', monthDay: '32' }, 'Enter a day of the month from 1 to 31.'],
      [{ freq: 'once' }, 'Choose a date.'],
      [{ freq: 'once', onDate: '2026-02-30' }, 'Check the schedule: that date or day isn’t valid.'],
      [{ dueTime: '25:00' }, 'Enter a due time like 7:30 am, or leave it empty.'],
      [{ dayTypes: [] }, 'Choose at least one kind of day.'],
      [{ points: '2.5' }, 'Points are a whole number from 0 to 1,000.'],
      [{ points: '1001' }, 'Points are a whole number from 0 to 1,000.'],
    ];
    for (const [change, message] of cases) {
      expect(parseChore(form({ ...base, ...change }), { canSetVisibility: true }), message).toEqual(
        { ok: false, message },
      );
    }
  });

  it('[CHR-01] an empty icon falls back to the list icon; an unknown approval to the family setting', () => {
    const parsed = parseChore(form({ ...base, icon: '', approval: 'sometimes' }), {
      canSetVisibility: true,
    });
    expect(parsed.ok && [parsed.value.icon, parsed.value.approval]).toEqual([
      'list-check',
      'inherit',
    ]);
  });

  it('[CHR-01] builds the payload save_chore takes', () => {
    const parsed = parseChore(form(base), { canSetVisibility: false });
    expect(parsed.ok && chorePayload(parsed.value)).toEqual({
      kind: 'chore',
      title: 'Make bed',
      icon: 'chore-bed',
      points: 5,
      approval: 'inherit',
      assignment: 'each',
      schedule: { freq: 'daily' },
      due_time: '07:30',
      day_types: ALL_DAYS,
    });
  });
});

describe('choreSaveMessage', () => {
  it('[CHR-13] maps the database hints to lines for the admin', () => {
    expect(choreSaveMessage({ hint: 'visibility_creator_only', code: '42501' })).toBe(
      'Only the person who created this item can change who sees it.',
    );
    expect(choreSaveMessage({ hint: 'chore_needs_assignee', code: '23514' })).toBe(
      'Choose who it’s for.',
    );
    expect(choreSaveMessage({ code: 'P0002' })).toMatch(/isn’t there any more/);
    expect(choreSaveMessage({ code: '23514' })).toMatch(/Check the schedule/);
    expect(choreSaveMessage({ code: '08006' })).toBe('That didn’t save. Try again in a moment.');
  });
});

describe('words for the list', () => {
  it('[CHR-11] groups due times into morning, after school, evening and anytime', () => {
    expect(
      ['07:30', '11:59', '12:00', '16:00', '16:59', '17:00', '19:00', null].map(dayPart),
    ).toEqual([
      'morning',
      'morning',
      'after_school',
      'after_school',
      'after_school',
      'evening',
      'evening',
      'anytime',
    ]);
  });

  it('[CHR-11] writes times the brand way', () => {
    expect(['07:30', '07:30:00', '00:05', '12:00', '16:00', '23:59'].map(clock)).toEqual([
      '7:30 am',
      '7:30 am',
      '12:05 am',
      '12:00 pm',
      '4:00 pm',
      '11:59 pm',
    ]);
  });

  it('[CHR-01] describes schedules in words', () => {
    expect(describeSchedule({ freq: 'daily' })).toBe('Every day');
    expect(describeSchedule({ freq: 'daily', interval: 2 })).toBe('Every 2 days');
    expect(describeSchedule({ freq: 'weekly', by_weekday: [5, 1, 2, 3, 4] })).toBe('Weekdays');
    expect(describeSchedule({ freq: 'weekly', by_weekday: [6, 7] })).toBe('Weekends');
    expect(describeSchedule({ freq: 'weekly', by_weekday: [1, 2, 3, 4, 5, 6, 7] })).toBe(
      'Every day',
    );
    expect(describeSchedule({ freq: 'weekly', by_weekday: [1, 3, 5] })).toBe('Mon, Wed and Fri');
    expect(describeSchedule({ freq: 'weekly', by_weekday: [4] })).toBe('Thu');
    expect(describeSchedule({ freq: 'weekly', by_weekday: [2, 4], interval: 2 })).toBe(
      'Every 2 weeks: Tue and Thu',
    );
    expect(describeSchedule({ freq: 'monthly', by_month_day: [1] })).toBe('Monthly on the 1st');
    expect(describeSchedule({ freq: 'monthly', by_month_day: [22, 2, 11] })).toBe(
      'Monthly on the 2nd, 11th and 22nd',
    );
    expect(describeSchedule({ freq: 'once', on_date: '2026-11-02' }, 'task')).toBe(
      'Due Mon, Nov 2',
    );
    expect(describeSchedule({ freq: 'once', on_date: '2026-11-02' }, 'chore')).toBe(
      'Once, Mon, Nov 2',
    );
  });
});

describe('filters', () => {
  const item = (over: Partial<ListItem>): ListItem => ({
    id: over.title ?? 'x',
    title: 'x',
    kind: 'chore',
    dueTime: null,
    assignees: [MAYA],
    tags: [],
    archivedAt: null,
    ...over,
  });
  const items = [
    item({ title: 'Homework', dueTime: '16:00:00', tags: [KITCHEN] }),
    item({ title: 'Make bed', dueTime: '07:30:00' }),
    item({ title: 'Pay fees', kind: 'task', assignees: [ALEX] }),
    item({ title: 'Brush teeth', dueTime: '07:30:00' }),
    item({ title: 'Old chore', archivedAt: '2026-10-01T00:00:00Z', tags: [KITCHEN] }),
    item({ title: 'Dishes', tags: [KITCHEN], assignees: [MAYA, ALEX] }),
  ];
  const titles = (f: Partial<ReturnType<typeof parseFilters>>) =>
    filterItems(items, { ...parseFilters({}), ...f }).map((i) => i.title);

  it('[CHR-01] lists active items, chores first, by due time then name', () => {
    expect(titles({})).toEqual(['Brush teeth', 'Make bed', 'Homework', 'Dishes', 'Pay fees']);
  });

  it('[CHR-01][CHR-09][CHR-10][CHR-11] filters by person, tag, kind, time of day and status', () => {
    expect(titles({ person: ALEX })).toEqual(['Dishes', 'Pay fees']);
    expect(titles({ tag: KITCHEN })).toEqual(['Homework', 'Dishes']);
    expect(titles({ kind: 'task' })).toEqual(['Pay fees']);
    expect(titles({ when: 'morning' })).toEqual(['Brush teeth', 'Make bed']);
    expect(titles({ when: 'anytime' })).toEqual(['Dishes', 'Pay fees']);
    expect(titles({ status: 'archived' })).toEqual(['Old chore']);
    expect(titles({ tag: KITCHEN, person: ALEX })).toEqual(['Dishes']);
  });

  it('[CHR-01] reads filters from the query string and ignores anything unknown', () => {
    expect(
      parseFilters({
        person: MAYA,
        tag: ['bogus'],
        kind: 'task',
        when: 'night',
        status: 'archived',
      }),
    ).toEqual({ person: MAYA, tag: null, kind: 'task', when: null, status: 'archived' });
  });
});

describe('occurrences', () => {
  it('[CHR-03] names today and tomorrow, and dates after that', () => {
    expect(relativeDay('2026-10-09', '2026-10-09')).toBe('Today');
    expect(relativeDay('2026-10-10', '2026-10-09')).toBe('Tomorrow');
    expect(relativeDay('2026-10-12', '2026-10-09')).toBe('Mon, Oct 12');
    expect(relativeDay('2026-11-01', '2026-10-31')).toBe('Tomorrow');
    expect(relativeDay('2026-10-08', '2026-10-09')).toBe('Yesterday');
    expect(relativeDay('2026-02-28', '2026-03-01')).toBe('Yesterday');
  });

  it('[CHR-07][CHR-09] a past day says what happened and who did it, in words', () => {
    const names = (id: string) => ({ [MAYA]: 'Maya', [ALEX]: 'Alex' })[id] ?? 'Someone';
    const line = (
      status: Parameters<typeof historyLine>[0]['status'],
      doneBy: string[] = [],
      kind: 'chore' | 'task' = 'chore',
    ) => historyLine({ status, doneBy }, kind, names);
    expect(line('completed', [MAYA, ALEX])).toEqual({
      icon: 'check-circle',
      text: 'Done by Maya and Alex',
      tone: 'done',
    });
    expect(line('approved', [MAYA]).text).toBe('Approved · done by Maya');
    expect(line('pending_approval', [MAYA])).toMatchObject({
      text: 'Needs review · checked off by Maya',
      tone: 'waiting',
    });
    expect(line('missed')).toEqual({ icon: 'minus-circle', text: 'Missed', tone: 'missed' });
    expect(line('skipped').text).toBe('Skipped');
    expect(line('rejected').text).toBe('Sent back');
    expect(line('scheduled').text).toBe('Open');
    expect(line('scheduled', [], 'task')).toEqual({
      icon: 'hourglass',
      text: 'Overdue',
      tone: 'late',
    });
  });

  it('[CHR-18] a person’s own day leads with their name, and says who did it only when someone else did', () => {
    const names = (id: string) => ({ [MAYA]: 'Maya', [ALEX]: 'Alex' })[id] ?? 'Someone';
    const own = (status: Parameters<typeof historyLine>[0]['status'], doneBy: string[] = []) =>
      historyLine({ status, doneBy, memberId: MAYA }, 'chore', names).text;
    expect(own('completed', [MAYA])).toBe('Maya: done');
    expect(own('completed', [ALEX])).toBe('Maya: done by Alex');
    expect(own('approved', [MAYA])).toBe('Maya: approved · done');
    expect(own('pending_approval', [MAYA])).toBe('Maya: needs review · checked off');
    expect(own('missed')).toBe('Maya: missed');
    expect(own('scheduled')).toBe('Maya: open');
  });

  it('[CHR-18] a new chore starts as everyone does their own, a new task as any one of them', () => {
    expect(defaultAssignment('chore')).toBe('each');
    expect(defaultAssignment('task')).toBe('shared');
  });

  it('[CHR-03][CHR-12] finds each item’s next date and how long a task has been left open', () => {
    const s = dueSummary(
      [
        { choreId: 'bed', dueDate: '2026-10-11', kind: 'chore', status: 'scheduled' },
        { choreId: 'bed', dueDate: '2026-10-09', kind: 'chore', status: 'scheduled' },
        { choreId: 'bed', dueDate: '2026-10-08', kind: 'chore', status: 'missed' },
        { choreId: 'fees', dueDate: '2026-10-05', kind: 'task', status: 'scheduled' },
        { choreId: 'fees', dueDate: '2026-10-07', kind: 'task', status: 'scheduled' },
        { choreId: 'done', dueDate: '2026-10-06', kind: 'task', status: 'completed' },
      ],
      '2026-10-09',
    );
    expect(s.get('bed')).toEqual({ next: '2026-10-09', overdueSince: null });
    expect(s.get('fees')).toEqual({ next: null, overdueSince: '2026-10-05' });
    expect(s.get('done')).toEqual({ next: null, overdueSince: null });
  });
});
