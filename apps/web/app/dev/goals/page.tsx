import { Button, Fold } from '@familywise/ui';
import type { Metadata } from 'next';
import { AdminHeader } from '../../(admin)/admin/header';
import type { DayMark } from '@familywise/rules-engine';
import type { GoalPeriod } from '@/lib/goal-periods';
import type { GoalRow } from '../../(admin)/admin/goals/data';
import { GoalForm } from '../../(admin)/admin/goals/goal-form';
import { WeeksFold } from '../../(admin)/admin/goals/repeating';
import { GoalHead, GoalStatusPill, GoalsView } from '../../(admin)/admin/goals/view';
import { goalSteps } from '@/lib/goal-steps';
import type { IconName } from '@familywise/ui';
import type { GoalItem } from '@/lib/goal-items';
import { DEV } from './facts';

// The admin Goals page and goal form (WP-19, WP-39) with a made-up family and no database, for the UI
// suite: the list in Day or Evening (?theme=evening), the form for a new goal (?form=new), for one
// that has started (?form=started), and that one with a preview of a change (?form=preview). Today is
// Thursday, Oct 15, 2026: Maya's and Leo's goals repeat each week (WP-80), and Friday is a day off.
export const metadata: Metadata = { title: 'Goals', robots: { index: false } };

const MAYA = 'f2000000-0000-4000-8000-000000000001';
const LEO = 'f2000000-0000-4000-8000-000000000002';
const MORNING = 'f2a00000-0000-4000-8000-000000000001';
const KITCHEN = 'f2a00000-0000-4000-8000-000000000002';
const BED = 'f2c00000-0000-4000-8000-000000000001';
const ICE_CREAM = 'f2f00000-0000-4000-8000-000000000001';
const PRIZES = [
  { id: ICE_CREAM, title: 'Ice cream', cost: 30 },
  { id: 'f2f00000-0000-4000-8000-000000000002', title: 'Stay up 30 minutes late', cost: 25 },
];

const goal = (o: Partial<GoalRow> & Pick<GoalRow, 'id' | 'title' | 'status'>): GoalRow => ({
  memberId: LEO,
  description: null,
  icon: 'trophy',
  imagePath: null,
  imageUrl: null,
  startDate: '2026-10-03',
  endDate: '2026-10-17',
  logic: 'all',
  repeat: 'none',
  periods: [],
  payout: { type: 'custom' },
  achievementCount: 0,
  achievedAt: null,
  redeemedAt: null,
  redeemedBy: null,
  needsReview: false,
  archivedAt: null,
  createdAt: '2026-10-03T12:00:00Z',
  pct: 0,
  computedAt: '2026-10-10T12:00:00Z',
  rules: [],
  ...o,
});

const TODAY = '2026-10-15';
const HOMEWORK = 'f2c00000-0000-4000-8000-000000000003';
const READING = 'f2c00000-0000-4000-8000-000000000004';

/** A week of a repeating goal: from Monday `start`, each day's mark, Friday Oct 16 a day off school. */
function week(
  start: string,
  outcome: GoalPeriod['outcome'],
  marks: DayMark[],
  missesAllowed = 0,
): GoalPeriod {
  const day = (n: number) => {
    const d = new Date(`${start}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const days = marks.map((mark, i) => ({
    date: day(i),
    mark,
    dayType: mark === 'none' ? (i >= 5 ? 'weekend' : 'no_school') : null,
  }));
  return {
    start,
    end: day(6),
    outcome,
    nextStart: day(7),
    daysDue: days.filter((d) => d.mark !== 'none').length,
    daysDone: days.filter((d) => d.mark === 'done').length,
    daysMissed: days.filter((d) => d.mark === 'missed').length,
    missesAllowed,
    days,
  };
}
const SCHOOL_WEEK = ['done', 'done', 'done', 'done', 'done', 'none', 'none'] as const;

/** [RWD-17][RWD-18] A week won or going at a step (WP-81). */
const stepWeek = (
  start: string,
  outcome: GoalPeriod['outcome'],
  marks: DayMark[],
  step: number | null,
  stepBest: number | null,
): GoalPeriod => ({
  ...week(start, outcome, marks, 2),
  daysMissed: marks.filter((m) => m === 'missed' || m === 'late').length,
  step,
  stepBest,
});
const STEPS_PAYOUT = {
  type: 'points' as const,
  amount: 20,
  steps: [
    { misses: 1, amount: 10 },
    { misses: 2, amount: 5 },
  ],
};

/** [RWD-17][RWD-18] Maya's goals done by a time and paid in steps (WP-81, ?list=steps). */
const STEP_GOALS: GoalRow[] = [
  goal({
    id: 'g10',
    title: 'Homework before 6 pm',
    memberId: MAYA,
    icon: 'backpack',
    status: 'active',
    repeat: 'week',
    startDate: '2026-09-14',
    endDate: null,
    payout: STEPS_PAYOUT,
    pct: 60,
    achievementCount: 3,
    periods: [
      stepWeek(
        '2026-09-14',
        'won',
        ['done', 'done', 'late', 'missed', 'done', 'none', 'none'],
        2,
        2,
      ),
      stepWeek('2026-09-21', 'won', [...SCHOOL_WEEK], 0, 0),
      stepWeek(
        '2026-09-28',
        'missed',
        ['done', 'missed', 'late', 'missed', 'done', 'none', 'none'],
        null,
        null,
      ),
      stepWeek('2026-10-05', 'won', ['done', 'late', 'done', 'done', 'done', 'none', 'none'], 1, 1),
      stepWeek(
        '2026-10-12',
        'open',
        ['done', 'done', 'late', 'today', 'later', 'none', 'none'],
        null,
        1,
      ),
    ],
    rules: [
      {
        id: 'r10',
        type: 'DAYS_DUE',
        target: 1,
        scope: { chore_ids: [HOMEWORK] },
        params: { misses_allowed: 2, on_time: '18:00' },
        progress: { current: 2, pct: 67, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g11',
    title: 'Read 20 books',
    memberId: MAYA,
    icon: 'book-open',
    status: 'active',
    startDate: '2026-09-01',
    endDate: '2026-12-20',
    payout: {
      type: 'points',
      amount: 20,
      steps: [
        { at: 15, amount: 10 },
        { at: 10, amount: 5 },
      ],
    },
    pct: 80,
    step: 1,
    stepBest: 0,
    rules: [
      {
        id: 'r11',
        type: 'COUNT',
        target: 20,
        scope: { chore_ids: [READING] },
        params: {},
        progress: { current: 16, pct: 80, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
];

const GOALS: GoalRow[] = [
  goal({
    id: 'g8',
    title: 'Homework home every school day',
    memberId: MAYA,
    icon: 'backpack',
    status: 'active',
    repeat: 'week',
    startDate: '2026-09-14',
    endDate: null,
    payout: { type: 'points', amount: 10 },
    pct: 75,
    achievementCount: 3,
    periods: [
      week('2026-09-14', 'won', ['none', 'done', 'done', 'done', 'done', 'none', 'none']),
      week('2026-09-21', 'won', [...SCHOOL_WEEK]),
      week('2026-09-28', 'missed', ['done', 'missed', 'done', 'done', 'done', 'none', 'none']),
      week('2026-10-05', 'won', [...SCHOOL_WEEK]),
      week('2026-10-12', 'open', ['done', 'done', 'done', 'today', 'none', 'none', 'none']),
    ],
    rules: [
      {
        id: 'r8',
        type: 'DAYS_DUE',
        target: 1,
        scope: { chore_ids: [HOMEWORK] },
        params: { misses_allowed: 0 },
        progress: { current: 3, pct: 75, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g9',
    title: 'Reading every day it’s due',
    memberId: LEO,
    icon: 'book-open',
    status: 'active',
    repeat: 'week',
    startDate: '2026-09-14',
    endDate: null,
    payout: { type: 'points', amount: 10 },
    pct: 40,
    achievementCount: 2,
    periods: [
      week('2026-09-14', 'won', [...SCHOOL_WEEK], 1),
      week('2026-09-21', 'missed', ['done', 'missed', 'missed', 'done', 'done', 'none', 'none'], 1),
      week('2026-09-28', 'neutral', ['none', 'none', 'none', 'none', 'none', 'none', 'none'], 1),
      week('2026-10-05', 'won', ['done', 'done', 'missed', 'done', 'done', 'none', 'none'], 1),
      week(
        '2026-10-12',
        'missed',
        ['done', 'missed', 'missed', 'today', 'none', 'none', 'none'],
        1,
      ),
    ],
    rules: [
      {
        id: 'r9',
        type: 'DAYS_DUE',
        target: 1,
        scope: { chore_ids: [READING] },
        params: { misses_allowed: 1 },
        progress: { current: 1, pct: 25, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g1',
    title: 'Movie night',
    description: 'Leo picks the film.',
    icon: 'ticket',
    status: 'active',
    payout: { type: 'points', amount: 50 },
    pct: 94.74,
    rules: [
      {
        id: 'r1',
        type: 'COUNT',
        target: 19,
        scope: { all: true },
        params: {},
        progress: { current: 18, pct: 94.74, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g2',
    title: 'Trip to the park',
    memberId: MAYA,
    icon: 'sun',
    status: 'achieved',
    payout: { type: 'catalog_item', item_id: ICE_CREAM },
    needsReview: true,
    achievementCount: 2,
    pct: 100,
    logic: 'all',
    rules: [
      {
        id: 'r2',
        type: 'STREAK',
        target: 5,
        scope: { all: true },
        params: { grace_per_week: 1 },
        progress: { current: 5, pct: 100, met: true, currentStreak: 5, bestStreak: 6 },
      },
      {
        id: 'r3',
        type: 'COUNT',
        target: 20,
        scope: { tag_ids: [MORNING, KITCHEN] },
        params: {},
        progress: { current: 22, pct: 100, met: true, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g3',
    title: 'Pizza night',
    memberId: null,
    icon: 'utensils',
    status: 'active',
    pct: 40,
    endDate: null,
    rules: [
      {
        id: 'r4',
        type: 'DAILY_ALL_DONE',
        target: 10,
        scope: { all: true },
        params: {},
        progress: { current: 4, pct: 40, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g4',
    title: 'Bike ride',
    status: 'scheduled',
    startDate: '2026-10-14',
    endDate: '2026-10-28',
    pct: null,
    computedAt: null,
    rules: [
      {
        id: 'r5',
        type: 'POINTS',
        target: 150,
        scope: { chore_ids: [BED] },
        params: {},
        progress: null,
      },
    ],
  }),
  goal({
    id: 'g5',
    title: 'Zoo trip',
    memberId: MAYA,
    status: 'redeemed',
    redeemedAt: '2026-10-01T18:00:00Z',
    redeemedBy: 'u1',
    needsReview: true,
  }),
  goal({ id: 'g6', title: 'New book', status: 'expired', endDate: '2026-09-30' }),
  goal({
    id: 'g7',
    title: 'Sleepover',
    memberId: MAYA,
    status: 'cancelled',
    archivedAt: '2026-09-20T09:00:00Z',
  }),
];

/**
 * [RWD-19][RWD-20] WP-82 (?list=perfect, ?form=family, ?form=perfect, ?form=family-weeks): the family's
 * "Everyone's homework home", every child meets it, missed this week on Leo's Tuesday (Leo had nothing
 * due the week of Sep 14); and Maya's "3 perfect homework weeks in a row", counting her homework weeks
 * (g8) since Sep 21, paying the ice cream.
 */
const kid = (
  memberId: string,
  outcome: GoalPeriod['outcome'],
  marks: DayMark[] | null,
  start: string,
): NonNullable<GoalPeriod['children']>[number] => {
  const w = marks ? week(start, outcome, marks) : null;
  return {
    memberId,
    contributes: marks !== null,
    outcome: marks ? outcome : 'neutral',
    pct: w && w.daysDue ? Math.round(((w.daysDone ?? 0) / w.daysDue) * 100) : 0,
    daysDue: w?.daysDue ?? null,
    daysDone: w?.daysDone ?? null,
    daysMissed: w?.daysMissed ?? null,
    days: w?.days ?? null,
  };
};
const familyWeek = (
  start: string,
  outcome: GoalPeriod['outcome'],
  maya: [GoalPeriod['outcome'], DayMark[] | null],
  leo: [GoalPeriod['outcome'], DayMark[] | null],
): GoalPeriod => ({
  ...week(start, outcome, ['none', 'none', 'none', 'none', 'none', 'none', 'none']),
  daysDue: null,
  daysDone: null,
  daysMissed: null,
  days: null,
  children: [kid(MAYA, maya[0], maya[1], start), kid(LEO, leo[0], leo[1], start)],
});
const PERFECT_GOALS: GoalRow[] = [
  goal({
    id: 'g20',
    title: 'Everyone’s homework home',
    memberId: null,
    icon: 'family',
    status: 'active',
    repeat: 'week',
    eachChild: true,
    startDate: '2026-09-14',
    endDate: null,
    payout: { type: 'points', amount: 20 },
    pct: 75,
    achievementCount: 2,
    periods: [
      familyWeek(
        '2026-09-14',
        'won',
        ['won', ['none', 'done', 'done', 'done', 'done', 'none', 'none']],
        ['neutral', null],
      ),
      familyWeek(
        '2026-09-21',
        'missed',
        ['won', [...SCHOOL_WEEK]],
        ['missed', ['missed', 'done', 'done', 'missed', 'done', 'none', 'none']],
      ),
      familyWeek('2026-09-28', 'neutral', ['neutral', null], ['neutral', null]),
      familyWeek('2026-10-05', 'won', ['won', [...SCHOOL_WEEK]], ['won', [...SCHOOL_WEEK]]),
      familyWeek(
        '2026-10-12',
        'missed',
        ['open', ['done', 'done', 'done', 'today', 'none', 'none', 'none']],
        ['missed', ['done', 'missed', 'done', 'today', 'none', 'none', 'none']],
      ),
    ],
    rules: [
      {
        id: 'r20',
        type: 'DAYS_DUE',
        target: 1,
        scope: { chore_ids: [HOMEWORK] },
        params: { misses_allowed: 0 },
        progress: { current: 3, pct: 75, met: false, currentStreak: null, bestStreak: null },
      },
    ],
  }),
  goal({
    id: 'g21',
    title: '3 perfect homework weeks in a row',
    memberId: MAYA,
    icon: 'snack',
    status: 'active',
    startDate: '2026-09-21',
    endDate: null,
    payout: { type: 'catalog_item', item_id: ICE_CREAM },
    pct: 33,
    rules: [
      {
        id: 'r21',
        type: 'PERIODS_WON',
        target: 3,
        scope: { all: true },
        params: { goal_id: 'g8', in_a_row: true },
        progress: { current: 1, pct: 33, met: false, currentStreak: 1, bestStreak: 1 },
      },
    ],
  }),
];

const MEMBERS = [
  { id: MAYA, displayName: 'Maya', avatarKey: 'fox' as const, color: 'member-3' as const },
  { id: LEO, displayName: 'Leo', avatarKey: 'frog' as const, color: 'member-4' as const },
];
const TAGS = [
  { id: MORNING, name: 'Morning' },
  { id: KITCHEN, name: 'Kitchen' },
];
// [NFR-16-n] Each item with its picture (WP-101).
const ITEMS = DEV.items.map((i) => ({ ...i }));

// [RWD-21] WP-114's items: who each is for, whether it repeats or its day, and whether it is over.
const item114 = (
  n: number,
  title: string,
  icon: IconName,
  o: Partial<GoalItem> = {},
): GoalItem => ({
  id: `f2c10000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  title,
  icon,
  kind: 'chore',
  assignees: [LEO],
  repeats: true,
  day: null,
  over: null,
  ...o,
});
const ITEMS_114: GoalItem[] = [
  item114(1, 'Brush teeth', 'chore-teeth', { assignees: [LEO, MAYA] }),
  item114(2, 'Feed the dog', 'chore-pet'),
  item114(3, 'Homework', 'chore-homework', { assignees: [LEO, MAYA] }),
  item114(4, 'Make bed', 'chore-bed'),
  item114(5, 'Read 20 minutes', 'chore-read', { assignees: [MAYA] }),
  item114(6, 'Set the table', 'chore-table', { assignees: [MAYA] }),
  item114(7, 'Return library books', 'chore-read', {
    kind: 'task',
    repeats: false,
    day: '2026-10-26',
  }),
  item114(8, 'Pack for the school trip', 'chore-pack', { repeats: false, day: '2026-10-30' }),
  item114(9, 'Carve the pumpkin', 'chore-outdoors', { repeats: false, day: '2026-10-31' }),
  item114(10, 'Write thank-you cards', 'chore-homework', {
    kind: 'task',
    repeats: false,
    day: '2026-11-05',
  }),
  item114(11, 'Try on the costume', 'chore-laundry', {
    assignees: [MAYA],
    repeats: false,
    day: '2026-10-31',
  }),
  item114(12, 'Clean out the car', 'chore-outdoors', {
    repeats: false,
    day: '2026-10-20',
    over: 'done',
  }),
  item114(13, 'Water the plants', 'chore-plant', { over: 'archived' }),
];

export default async function DevGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; form?: string; list?: string; open?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  // [RWD-14] no-end: a started goal with no end date (WP-79); reached: an achieved goal, locked (D-115).
  const forms = ['new', 'started', 'preview', 'no-end', 'reached'];
  // [RWD-17][RWD-18] steps: Maya's "Homework before 6 pm" page, by a time and in steps, its weeks;
  // weighted: a new goal with two weighted rules in steps; count-steps: a one-off goal in steps (WP-81).
  // [RWD-19][RWD-20] WP-82: the every-child goal and the perfect weeks on Goals, their forms, and the
  // family goal's weeks.
  if (params.list === 'perfect') {
    return (
      <div className={`admin ${theme}`}>
        <GoalsView
          goals={[...PERFECT_GOALS, GOALS.find((g) => g.id === 'g8')!]}
          members={MEMBERS}
          names={{
            tags: new Map(TAGS.map((t) => [t.id, t.name])),
            items: new Map(ITEMS.map((t) => [t.id, t.title])),
          }}
          admins={new Map([['u1', 'Alex']])}
          prizes={new Map(PRIZES.map((p) => [p.id, p.title]))}
          timezone="America/New_York"
          today={TODAY}
          notice={null}
          error={null}
        />
      </div>
    );
  }
  if (params.form === 'family' || params.form === 'perfect' || params.form === 'family-weeks') {
    const family = PERFECT_GOALS[0]!;
    const counted = params.form === 'perfect';
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          {params.form === 'family-weeks' ? (
            <GoalHead
              title={family.title}
              pill={<GoalStatusPill goal={family} today={TODAY} />}
              line="The whole family · every child meets it · each week · 20 points each"
            />
          ) : (
            <GoalHead title="Set a goal" />
          )}
          <section className="fw-card">
            <GoalForm
              id={
                counted
                  ? 'f2e00000-0000-4000-8000-000000000021'
                  : 'f2e00000-0000-4000-8000-000000000020'
              }
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
              livePath="/dev/goals/summaries"
              today={TODAY}
              lock={params.form === 'family-weeks' ? 'started' : 'none'}
              countable={[
                {
                  id: DEV.homeworkGoal,
                  title: 'Homework home every school day',
                  memberId: MAYA,
                  repeat: 'week',
                },
              ]}
              initial={
                counted
                  ? {
                      title: '3 perfect homework weeks in a row',
                      description: null,
                      icon: 'snack',
                      memberId: MAYA,
                      startDate: TODAY,
                      endDate: null,
                      logic: 'all',
                      repeat: 'none',
                      payout: { type: 'catalog_item', item_id: ICE_CREAM },
                      rules: [
                        {
                          type: 'PERIODS_WON',
                          target: 3,
                          scope: 'all',
                          tagIds: [],
                          itemIds: [],
                          grace: 1,
                          source: DEV.homeworkGoal,
                          inARow: true,
                        },
                      ],
                    }
                  : {
                      title: family.title,
                      description: null,
                      icon: 'family',
                      memberId: null,
                      startDate: params.form === 'family-weeks' ? family.startDate : '2026-10-12',
                      endDate: null,
                      logic: 'all',
                      repeat: 'week',
                      eachChild: true,
                      payout: { type: 'points', amount: 20 },
                      rules: [
                        {
                          type: 'DAYS_DUE',
                          target: 1,
                          scope: 'items',
                          tagIds: [],
                          itemIds: [HOMEWORK],
                          grace: 1,
                          misses: 0,
                        },
                      ],
                    }
              }
            />
          </section>
          {params.form === 'family-weeks' ? (
            <WeeksFold
              repeat="week"
              periods={family.periods}
              today={TODAY}
              points={20}
              who={{
                name: (id) => MEMBERS.find((m) => m.id === id)?.displayName ?? 'Someone',
                member: (id) => MEMBERS.find((m) => m.id === id),
              }}
            />
          ) : null}
        </main>
      </div>
    );
  }
  if (params.list === 'steps') {
    return (
      <div className={`admin ${theme}`}>
        <GoalsView
          goals={STEP_GOALS}
          members={MEMBERS}
          names={{
            tags: new Map(TAGS.map((t) => [t.id, t.name])),
            items: new Map(ITEMS.map((t) => [t.id, t.title])),
          }}
          admins={new Map([['u1', 'Alex']])}
          prizes={new Map(PRIZES.map((p) => [p.id, p.title]))}
          timezone="America/New_York"
          today={TODAY}
          notice={null}
          error={null}
        />
      </div>
    );
  }
  if (params.form === 'steps' || params.form === 'weighted' || params.form === 'count-steps') {
    const g = STEP_GOALS[0]!;
    const initial =
      params.form === 'steps'
        ? {
            title: g.title,
            description: null,
            icon: 'backpack' as const,
            memberId: MAYA,
            startDate: g.startDate,
            endDate: null,
            logic: 'all' as const,
            repeat: 'week' as const,
            payout: STEPS_PAYOUT,
            rules: [
              {
                type: 'DAYS_DUE' as const,
                target: 1,
                scope: 'items' as const,
                tagIds: [],
                itemIds: [HOMEWORK],
                grace: 1,
                misses: 2,
                onTime: '18:00',
              },
            ],
          }
        : params.form === 'weighted'
          ? {
              title: 'School week',
              description: null,
              icon: 'backpack' as const,
              memberId: MAYA,
              startDate: '2026-10-12',
              endDate: null,
              logic: 'all' as const,
              repeat: 'week' as const,
              payout: {
                type: 'points' as const,
                amount: 20,
                steps: [
                  { at: 75, amount: 10 },
                  { at: 50, amount: 5 },
                ],
              },
              rules: [
                {
                  type: 'DAYS_DUE' as const,
                  target: 1,
                  scope: 'items' as const,
                  tagIds: [],
                  itemIds: [HOMEWORK],
                  grace: 1,
                  misses: 0,
                  onTime: '18:00',
                  weight: 60,
                },
                {
                  type: 'COUNT' as const,
                  target: 5,
                  scope: 'items' as const,
                  tagIds: [],
                  itemIds: [READING],
                  grace: 1,
                  weight: 40,
                },
              ],
            }
          : {
              title: 'Read 20 books',
              description: null,
              icon: 'book-open' as const,
              memberId: MAYA,
              startDate: '2026-09-01',
              endDate: '2026-12-20',
              logic: 'all' as const,
              repeat: 'none' as const,
              payout: STEP_GOALS[1]!.payout,
              rules: [
                {
                  type: 'COUNT' as const,
                  target: 20,
                  scope: 'items' as const,
                  tagIds: [],
                  itemIds: [READING],
                  grace: 1,
                },
              ],
            };
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <GoalHead title={params.form === 'weighted' ? 'Set a goal' : initial.title} />
          <section className="fw-card">
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000010"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
              livePath="/dev/goals/summaries"
              today={TODAY}
              lock={params.form === 'steps' ? 'started' : 'none'}
              initial={initial}
            />
          </section>
          {params.form === 'steps' ? (
            <WeeksFold
              repeat="week"
              periods={g.periods}
              today={TODAY}
              points={20}
              steps={goalSteps(g.payout, g.rules)}
              kind="misses"
            />
          ) : null}
        </main>
      </div>
    );
  }
  // [NFR-16][D-128] homework: a new goal filled in as the WP-80 frame "Set a goal: Maya's homework,
  // each week" draws it, its rule open with its live summary (WP-101).
  // [RWD-21][D-146] WP-114's mockup on the made-up family, Tuesday Oct 27: Some items for Leo
  // (items-new), with a done and an archived item kept (items), changed to Maya (items-maya), and a
  // goal ending Oct 29 (items-dates).
  if (params.form?.startsWith('items')) {
    const scene = params.form;
    const ids = (...titles: string[]) =>
      ITEMS_114.filter((i) => titles.includes(i.title)).map((i) => i.id);
    const itemIds =
      scene === 'items'
        ? ids('Feed the dog', 'Clean out the car', 'Water the plants')
        : scene === 'items-dates'
          ? ids('Feed the dog', 'Homework', 'Carve the pumpkin')
          : ids('Feed the dog', 'Homework');
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <GoalHead title="Set a goal" />
          <section className="fw-card">
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000040"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS_114}
              prizes={PRIZES}
              today="2026-10-27"
              livePath="/dev/goals/summaries"
              draft={{
                title: 'Dog week',
                description: null,
                icon: 'trophy',
                memberId: scene === 'items-maya' ? MAYA : LEO,
                startDate: '2026-10-27',
                endDate: scene === 'items-dates' ? '2026-10-29' : null,
                logic: 'all',
                payout: { type: 'custom' },
                rules: [
                  {
                    type: 'COUNT',
                    target: 5,
                    scope: 'items',
                    tagIds: [],
                    itemIds,
                    grace: 1,
                  },
                ],
              }}
            />
          </section>
        </main>
      </div>
    );
  }
  if (params.form === 'homework') {
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <GoalHead title="Set a goal" />
          <section className="fw-card">
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000030"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
              today="2026-10-12"
              livePath="/dev/goals/summaries"
              draft={{
                title: 'Homework home every school day',
                description: null,
                icon: 'backpack',
                memberId: MAYA,
                startDate: '2026-10-12',
                endDate: null,
                logic: 'all',
                repeat: 'week',
                payout: { type: 'points', amount: 10 },
                rules: [
                  {
                    type: 'DAYS_DUE',
                    target: 1,
                    scope: 'items',
                    tagIds: [],
                    itemIds: [HOMEWORK],
                    grace: 1,
                    misses: 0,
                  },
                ],
              }}
            />
          </section>
        </main>
      </div>
    );
  }
  // [RWD-15] repeating: Maya's homework goal's page, its form and its weeks (WP-80).
  if (params.form === 'repeating') {
    const homework = GOALS.find((g) => g.id === 'g8')!;
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <GoalHead
            title={homework.title}
            pill={<GoalStatusPill goal={homework} today={TODAY} />}
            line="Maya · each week · this week 3 of 4 days · Pays 10 points"
          />
          <section className="fw-card">
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000008"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
              livePath="/dev/goals/summaries"
              today={TODAY}
              lock="started"
              preview={{
                period: 'This week Homework home is due 4 days, so this week needs 4.',
                outcome: 'Its progress stays at 75%.',
                before: '75% there',
                after: '75% there',
                rows: [
                  {
                    text: 'Every day it’s due, from Homework home (no misses allowed)',
                    before: '3 of 4',
                    after: '3 of 4',
                    met: false,
                  },
                ],
              }}
              initial={{
                title: homework.title,
                description: null,
                icon: 'backpack',
                memberId: MAYA,
                startDate: homework.startDate,
                endDate: null,
                logic: 'all',
                repeat: 'week',
                payout: { type: 'points', amount: 10 },
                rules: [
                  {
                    type: 'DAYS_DUE',
                    target: 1,
                    scope: 'items',
                    tagIds: [],
                    itemIds: [HOMEWORK],
                    grace: 1,
                    misses: 0,
                  },
                ],
              }}
            />
          </section>
          <WeeksFold
            repeat="week"
            periods={homework.periods}
            today={TODAY}
            points={10}
            open={params.open === 'weeks'}
          />
          <Fold
            title="What happened"
            summary={[
              <span key="latest">
                <b>Latest:</b> week of Oct 5 won, 10 points paid, Friday · 9 events
              </span>,
            ]}
          >
            <p className="fw-muted">Week of Oct 5 won: 10 points paid · Friday, Oct 9</p>
          </Fold>
          <Fold title="Stop or cancel" summary={['Stop it after this week, or cancel it now']}>
            <p className="fw-muted">
              <b>Stop after this week</b> ends it on the last day of this week: it still counts and
              pays. <b>Cancel</b> stops it now; nothing more is paid.
            </p>
            <div className="fw-actions">
              <Button variant="secondary" icon="calendar-check">
                Stop after this week
              </Button>
              <Button variant="danger" icon="minus-circle">
                {`Cancel ${homework.title}`}
              </Button>
            </div>
          </Fold>
        </main>
      </div>
    );
  }
  if (params.form && forms.includes(params.form)) {
    const started = params.form !== 'new';
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <GoalHead title={started ? 'Trip to the park' : 'Set a goal'} />
          <section className="fw-card">
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000001"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
              livePath="/dev/goals/summaries"
              today="2026-10-10"
              lock={params.form === 'reached' ? 'finished' : started ? 'started' : 'none'}
              preview={
                params.form === 'preview'
                  ? {
                      // A going goal: a reached one keeps its rules, so has no preview (D-115).
                      outcome: 'Its progress goes from 96% to 88%.',
                      before: '96% there',
                      after: '88% there',
                      rows: [
                        {
                          text: '6 good days in a row (1 miss a week forgiven)',
                          before: null,
                          after: '5 of 6',
                          met: false,
                        },
                        {
                          text: '25 things done, tagged Morning',
                          before: null,
                          after: '22 of 25',
                          met: false,
                        },
                      ],
                    }
                  : undefined
              }
              initial={
                started
                  ? {
                      title: 'Trip to the park',
                      description: null,
                      icon: 'sun',
                      memberId: MAYA,
                      startDate: '2026-10-03',
                      endDate: params.form === 'no-end' ? null : '2026-10-24',
                      logic: 'any',
                      payout: { type: 'catalog_item', item_id: ICE_CREAM },
                      rules: [
                        {
                          type: 'STREAK',
                          target: 5,
                          scope: 'all',
                          tagIds: [],
                          itemIds: [],
                          grace: 1,
                        },
                        {
                          type: 'COUNT',
                          target: 20,
                          scope: 'tags',
                          tagIds: [MORNING],
                          itemIds: [],
                          grace: 1,
                        },
                      ],
                    }
                  : undefined
              }
            />
          </section>
        </main>
      </div>
    );
  }
  return (
    <div className={`admin ${theme}`}>
      <GoalsView
        goals={GOALS}
        members={MEMBERS}
        names={{
          tags: new Map(TAGS.map((t) => [t.id, t.name])),
          items: new Map(ITEMS.map((t) => [t.id, t.title])),
        }}
        admins={new Map([['u1', 'Alex']])}
        prizes={new Map(PRIZES.map((p) => [p.id, p.title]))}
        timezone="America/New_York"
        today={TODAY}
        notice={null}
        error={null}
      />
    </div>
  );
}
