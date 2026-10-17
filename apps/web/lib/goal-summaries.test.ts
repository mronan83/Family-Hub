import type { OccurrenceFact } from '@familywise/rules-engine';
import { dateWords, timeWords } from '@familywise/ui';
import { describe, expect, it } from 'vitest';
import { previewView } from './goal-preview';
import {
  closureWords,
  firstCounted,
  partsText,
  ruleProblem,
  ruleSummaryParts,
  scopeParts,
  type SummaryRule,
} from './goal-summaries';
import type { GoalFormValue, PreviewClosure, PreviewRead } from './goals';

// [NFR-16][D-128] The goal form's words as the approved mockups write them (WP-101): a rule's summary
// line, the live summaries worked out by Preview's own code (previewView, the rules engine), and
// dates and times. Made-up dates: the week of Monday, Oct 12, 2026, today Thursday, Oct 15.

const MAYA = 'a0000000-0000-4000-8000-00000000000a';
const LEO = 'a0000000-0000-4000-8000-00000000000b';
const HOMEWORK = 'c0000000-0000-4000-8000-000000000001';
const READING = 'c0000000-0000-4000-8000-000000000002';
const COUNTED = 'e0000000-0000-4000-8000-000000000001';
const names = {
  tags: [
    { id: 't1', name: 'Morning' },
    { id: 't2', name: 'Kitchen' },
  ],
  items: [
    { id: HOMEWORK, title: 'Homework home', icon: 'backpack' },
    { id: READING, title: 'Reading', icon: 'book-open' },
  ],
  goals: [{ id: COUNTED, title: 'Homework home every school day', repeat: 'week' as const }],
};
const rule = (o: Partial<SummaryRule>): SummaryRule => ({
  type: 'COUNT',
  target: 10,
  scope: 'all',
  tagIds: [],
  itemIds: [],
  grace: 1,
  ...o,
});

describe('a rule as one summary line', () => {
  it('[NFR-16-i] every day it’s due, its item with its picture, and its time', () => {
    const parts = ruleSummaryParts(
      rule({ type: 'DAYS_DUE', scope: 'items', itemIds: [HOMEWORK], onTime: '18:00' }),
      names,
    );
    expect(partsText(parts)).toBe('Every day it’s due: Homework home, by 6:00 pm');
    expect(parts).toContainEqual({ icon: 'backpack', text: 'Homework home' });
  });

  it('[NFR-16-i] things done with a target; tags; everything; misses, streaks and due times', () => {
    const text = (r: Partial<SummaryRule>) => partsText(ruleSummaryParts(rule(r), names));
    expect(text({ target: 5, scope: 'items', itemIds: [READING] })).toBe(
      'Things done: 5 · Reading',
    );
    expect(text({ target: 20, scope: 'tags', tagIds: ['t1', 't2'] })).toBe(
      'Things done: 20 · Morning or Kitchen items',
    );
    expect(text({ type: 'POINTS', target: 150 })).toBe('Points earned: 150 · everything');
    expect(text({ type: 'STREAK', target: 5, grace: 0 })).toBe(
      'Good days in a row: 5 · everything, no misses forgiven',
    );
    expect(text({ type: 'DAYS_DUE', scope: 'items', itemIds: [HOMEWORK], misses: 2 })).toBe(
      'Every day it’s due: Homework home, 2 misses allowed',
    );
    expect(text({ scope: 'items', itemIds: [HOMEWORK, READING], onTime: 'due_time' })).toBe(
      'Things done: 10 · Homework home or Reading, by each chore’s due time',
    );
    expect(text({ type: 'PERIODS_WON', target: 3, source: COUNTED, inARow: true })).toBe(
      'Weeks won of a repeating goal: 3 in a row · Homework home every school day',
    );
  });

  it('[NFR-16-i] What counts alone: "Some items: Homework home", tags, everything', () => {
    expect(partsText(scopeParts(rule({ scope: 'items', itemIds: [HOMEWORK] }), names))).toBe(
      'Some items: Homework home',
    );
    expect(partsText(scopeParts(rule({ scope: 'tags', tagIds: ['t2'] }), names))).toBe(
      'Some tags: Kitchen',
    );
    expect(partsText(scopeParts(rule({}), names))).toBe('Everything');
  });

  it('[NFR-16-j] what keeps a rule open: nothing chosen to count, no target, a weight out of range', () => {
    expect(ruleProblem(rule({ scope: 'items' }), false)).toBe('Choose an item it counts.');
    expect(ruleProblem(rule({ scope: 'tags' }), false)).toBe('Choose a tag it counts.');
    expect(ruleProblem(rule({ target: 0 }), false)).toBe('Give it a target from 1 to 100,000.');
    expect(ruleProblem({ ...rule({}), weight: 0 }, true)).toBe('Give it a weight from 1 to 100.');
    expect(ruleProblem({ ...rule({}), weight: 0 }, false)).toBeNull();
    expect(ruleProblem(rule({ type: 'DAYS_DUE', target: 0 }), false)).toBeNull();
  });
});

describe('dates and times as the frames write them', () => {
  it('[NFR-16-o] "Mon, Oct 12, 2026" for any date, across months, years and DST', () => {
    expect(dateWords('2026-10-12')).toBe('Mon, Oct 12, 2026');
    expect(dateWords('2026-11-01')).toBe('Sun, Nov 1, 2026'); // the US clocks change that night
    expect(dateWords('2026-03-08')).toBe('Sun, Mar 8, 2026');
    expect(dateWords('2026-12-31')).toBe('Thu, Dec 31, 2026');
    expect(dateWords('2027-01-01')).toBe('Fri, Jan 1, 2027');
    expect(dateWords('2028-02-29')).toBe('Tue, Feb 29, 2028');
    expect(dateWords('')).toBe('');
    expect(dateWords('10/12/2026')).toBe('');
  });

  it('[NFR-16-o] "6:00 pm" for any time, midnight and noon included', () => {
    expect(timeWords('18:00')).toBe('6:00 pm');
    expect(timeWords('18:00:00')).toBe('6:00 pm');
    expect(timeWords('00:00')).toBe('12:00 am');
    expect(timeWords('12:05')).toBe('12:05 pm');
    expect(timeWords('07:30')).toBe('7:30 am');
    expect(timeWords('23:59')).toBe('11:59 pm');
    expect(timeWords('24:00')).toBe('');
    expect(timeWords('')).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// The live summaries, through Preview's own code
// ---------------------------------------------------------------------------------------------

const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];
function fact(member: string, chore: string, day: string, status: OccurrenceFact['status']) {
  return {
    id: `${member}-${chore}-${day}`,
    chore_id: chore,
    member_id: member,
    kind: 'chore',
    tag_ids: [],
    due_date: day,
    credit_date: status === 'completed' ? day : null,
    status,
    credited: status === 'completed',
    points: 5,
    due_time: null,
    done_at: status === 'completed' ? `${day}T16:30` : null,
  } satisfies OccurrenceFact;
}
/** Maya: homework Monday to Wednesday, Thursday to do, reading all four days; Leo missed Tuesday. */
const FACTS: OccurrenceFact[] = WEEK.flatMap((day, i) => [
  fact(MAYA, HOMEWORK, day, i < 3 ? 'completed' : 'scheduled'),
  fact(MAYA, READING, day, 'completed'),
  fact(LEO, HOMEWORK, day, i === 1 ? 'missed' : i < 3 ? 'completed' : 'scheduled'),
]);
const planning = (member_id: string | null): PreviewClosure => ({
  date: '2026-10-16',
  member_id,
  name: 'Teacher planning day',
  kind: 'teacher_day',
});

function summaries(v: Partial<GoalFormValue>, read: Partial<PreviewRead> = {}) {
  const value: GoalFormValue = {
    id: 'f0000000-0000-4000-8000-000000000001',
    memberId: MAYA,
    title: 'Homework home',
    description: null,
    icon: 'backpack',
    startDate: '2026-10-12',
    endDate: null,
    logic: 'all',
    repeat: 'week',
    rules: [
      {
        type: 'DAYS_DUE',
        target: 1,
        scope: { chore_ids: [HOMEWORK] },
        params: { misses_allowed: 0 },
      },
    ],
    payout: { type: 'points', amount: 10 },
    ...v,
  };
  const facts: PreviewRead = {
    as_of: '2026-10-15',
    week_start: 1,
    status: 'scheduled',
    saved: false,
    terms: [],
    members: [MAYA, LEO],
    facts: FACTS.filter((f) => value.memberId === null || f.member_id === value.memberId),
    sources: {},
    closures: [planning(MAYA), planning(LEO), planning(null)],
    ...read,
  };
  return previewView(value, {
    facts,
    stored: null,
    storedPayout: null,
    tags: new Map(),
    items: new Map([
      [HOMEWORK, 'Homework home'],
      [READING, 'Reading'],
    ]),
    goals: new Map([[COUNTED, { title: 'Homework home every school day', repeat: 'week' }]]),
    prizes: new Map(),
    people: new Map([
      [MAYA, 'Maya'],
      [LEO, 'Leo'],
    ]),
  }).summaries!;
}

describe('the live summaries', () => {
  it('[NFR-16-k] under the rule: the week’s days due, the day off named, and a normal week', () => {
    expect(summaries({}).rules[0]).toBe(
      'This week Homework home is due 4 days for Maya (Friday, Oct 16 is a teacher planning day), so this week needs 4. A normal week needs 5.',
    );
    const one = summaries({
      rules: [
        {
          type: 'DAYS_DUE',
          target: 1,
          scope: { chore_ids: [HOMEWORK] },
          params: { misses_allowed: 1 },
        },
      ],
    });
    expect(one.rules[0]).toContain('so this week needs 3. A normal week needs 4.');
  });

  it('[NFR-16-k] a week with no day off says nothing of one', () => {
    const plain = summaries({}, { closures: [] });
    expect(plain.rules[0]).toBe(
      'This week Homework home is due 4 days for Maya, so this week needs 4.',
    );
  });

  it('[NFR-16-k] every child: each child’s days, the day off, what each needs', () => {
    const family = summaries({
      memberId: null,
      eachChild: true,
      payout: { type: 'points', amount: 20 },
    });
    expect(family.rules[0]).toBe(
      'This week Homework home is due 4 days for Maya and 4 days for Leo (Friday, Oct 16 is a teacher planning day): each needs 4.',
    );
  });

  it('[NFR-16-k] steps by days missed: what each step of this week pays', () => {
    const steps = summaries({
      rules: [
        {
          type: 'DAYS_DUE',
          target: 1,
          scope: { chore_ids: [HOMEWORK] },
          params: { misses_allowed: 2, on_time: '18:00' },
        },
      ],
      payout: {
        type: 'points',
        amount: 20,
        steps: [
          { misses: 1, amount: 10 },
          { misses: 2, amount: 5 },
        ],
      },
    });
    expect(steps.steps).toBe(
      'This week Homework home is due 4 days for Maya (Friday, Oct 16 is a teacher planning day): all 4 on time pays 20, 3 pays 10, 2 pays 5.',
    );
    expect(steps.rules[0]).toBeNull();
  });

  it('[NFR-16-k] weights: each rule’s % times its weight, the sum, what the week would pay', () => {
    const weighted = summaries({
      rules: [
        {
          type: 'DAYS_DUE',
          target: 1,
          scope: { chore_ids: [HOMEWORK] },
          params: { misses_allowed: 0 },
          weight: 60,
        },
        { type: 'COUNT', target: 5, scope: { chore_ids: [READING] }, params: {}, weight: 40 },
      ],
      payout: {
        type: 'points',
        amount: 20,
        steps: [
          { at: 75, amount: 10 },
          { at: 50, amount: 5 },
        ],
      },
    });
    expect(weighted.weights).toBe(
      'So far this week: Homework home 3 of 4 days (75%) × 60% = 45, Reading 4 of 5 (80%) × 40% = 32. 77%: 10 points if the week closes now.',
    );
  });

  it('[NFR-16-k][D-126] weeks won: the weeks that start on or after the goal’s start', () => {
    const counted = summaries(
      {
        repeat: 'none',
        startDate: '2026-10-15',
        rules: [
          {
            type: 'PERIODS_WON',
            target: 3,
            scope: { all: true },
            params: { goal_id: COUNTED, in_a_row: true },
          },
        ],
        payout: { type: 'custom' },
      },
      { facts: [] },
    );
    expect(counted.rules[0]).toBe(
      'A week counts when it starts on or after this goal’s start, Thu, Oct 15, 2026, so the first that counts is the week of Mon, Oct 19, 2026.',
    );
  });

  it('[NFR-16-k][D-126] the first week counted: on a week’s first day, across a month and a year', () => {
    expect(firstCounted('week', '2026-10-19', 1, [])).toBe('2026-10-19');
    expect(firstCounted('week', '2026-10-15', 0, [])).toBe('2026-10-18');
    expect(firstCounted('week', '2026-12-30', 1, [])).toBe('2027-01-04');
    expect(firstCounted('month', '2026-10-15', 1, [])).toBe('2026-11-01');
    expect(firstCounted('month', '2026-12-02', 1, [])).toBe('2027-01-01');
    expect(firstCounted('month', '2026-11-01', 1, [])).toBe('2026-11-01');
    expect(
      firstCounted('term', '2026-10-15', 1, [{ start: '2026-09-01' }, { start: '2027-01-05' }]),
    ).toBe('2027-01-05');
    expect(firstCounted('term', '2026-10-15', 1, [])).toBeNull();
  });

  it('[NFR-16-k] a closure in words: a day off, a break, a holiday', () => {
    expect(closureWords(planning(null))).toBe('Friday, Oct 16 is a teacher planning day');
    expect(
      closureWords({ date: '2026-11-26', member_id: null, name: 'Thanksgiving', kind: 'holiday' }),
    ).toBe('Thursday, Nov 26 is Thanksgiving');
    expect(
      closureWords({ date: '2026-12-21', member_id: null, name: 'Winter break', kind: 'break' }),
    ).toBe('Monday, Dec 21 is in Winter break');
    expect(
      closureWords({ date: '2027-01-27', member_id: null, name: 'Ice day', kind: 'snow_day' }),
    ).toBe('Wednesday, Jan 27 is an ice day');
  });
});
