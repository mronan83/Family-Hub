import type { Metadata } from 'next';
import { AdminHeader } from '../../(admin)/admin/header';
import type { DayMark } from '@familywise/rules-engine';
import type { GoalPeriod } from '@/lib/goal-periods';
import type { GoalRow } from '../../(admin)/admin/goals/data';
import { GoalForm } from '../../(admin)/admin/goals/goal-form';
import { WeeksFold } from '../../(admin)/admin/goals/repeating';
import { GoalsView } from '../../(admin)/admin/goals/view';

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

const MEMBERS = [
  { id: MAYA, displayName: 'Maya', avatarKey: 'fox' as const, color: 'member-3' as const },
  { id: LEO, displayName: 'Leo', avatarKey: 'frog' as const, color: 'member-4' as const },
];
const TAGS = [
  { id: MORNING, name: 'Morning' },
  { id: KITCHEN, name: 'Kitchen' },
];
const ITEMS = [
  { id: BED, title: 'Make bed' },
  { id: HOMEWORK, title: 'Homework home' },
  { id: READING, title: 'Reading' },
  { id: 'f2c00000-0000-4000-8000-000000000002', title: 'Set the table' },
];

export default async function DevGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; form?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  // [RWD-14] no-end: a started goal with no end date (WP-79); reached: an achieved goal, locked (D-115).
  const forms = ['new', 'started', 'preview', 'no-end', 'reached'];
  // [RWD-15] repeating: Maya's homework goal's page, its form and its weeks (WP-80).
  if (params.form === 'repeating') {
    const homework = GOALS.find((g) => g.id === 'g8')!;
    return (
      <div className={`admin ${theme}`}>
        <main className="fw-page">
          <AdminHeader current="/admin/goals" />
          <section className="fw-card">
            <h1>{homework.title}</h1>
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000008"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
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
          <WeeksFold repeat="week" periods={homework.periods} today={TODAY} points={10} />
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
          <section className="fw-card">
            <h1>{started ? 'Trip to the park' : 'Set a goal'}</h1>
            <GoalForm
              id="f2e00000-0000-4000-8000-000000000001"
              members={MEMBERS}
              tags={TAGS}
              items={ITEMS}
              prizes={PRIZES}
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
