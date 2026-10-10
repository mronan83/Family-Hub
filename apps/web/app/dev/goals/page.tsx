import type { Metadata } from 'next';
import { AdminHeader } from '../../(admin)/admin/header';
import { GOAL_ICONS, type GoalRow } from '../../(admin)/admin/goals/data';
import { GoalForm } from '../../(admin)/admin/goals/goal-form';
import { GoalsView } from '../../(admin)/admin/goals/view';

// The admin Goals page and goal form (WP-19) with a made-up family and no database, for the UI suite:
// the list in Day or Evening (?theme=evening), the form for a new goal (?form=new) and for one that
// has started (?form=started).
export const metadata: Metadata = { title: 'Goals', robots: { index: false } };

const MAYA = 'f2000000-0000-4000-8000-000000000001';
const LEO = 'f2000000-0000-4000-8000-000000000002';
const MORNING = 'f2a00000-0000-4000-8000-000000000001';
const KITCHEN = 'f2a00000-0000-4000-8000-000000000002';
const BED = 'f2c00000-0000-4000-8000-000000000001';

const goal = (o: Partial<GoalRow> & Pick<GoalRow, 'id' | 'title' | 'status'>): GoalRow => ({
  memberId: LEO,
  description: null,
  icon: 'trophy',
  imagePath: null,
  imageUrl: null,
  startDate: '2026-10-03',
  endDate: '2026-10-17',
  logic: 'all',
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

const GOALS: GoalRow[] = [
  goal({
    id: 'g1',
    title: 'Movie night',
    description: 'Leo picks the film.',
    icon: 'ticket',
    status: 'active',
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
  { id: 'f2c00000-0000-4000-8000-000000000002', title: 'Set the table' },
];

export default async function DevGoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; form?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  if (params.form === 'new' || params.form === 'started') {
    const started = params.form === 'started';
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
              icons={GOAL_ICONS}
              today="2026-10-10"
              lock={started ? 'started' : 'none'}
              initial={
                started
                  ? {
                      title: 'Trip to the park',
                      description: null,
                      icon: 'sun',
                      memberId: MAYA,
                      startDate: '2026-10-03',
                      endDate: '2026-10-24',
                      logic: 'any',
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
        timezone="America/New_York"
        notice={null}
        error={null}
      />
    </div>
  );
}
