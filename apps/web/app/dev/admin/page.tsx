import type { Metadata } from 'next';
import type { DayItem } from '@/lib/admin-day';
import { isoDay } from '@/lib/format';
import { MyTasksView } from '../../(admin)/admin/my/view';
import type { WaitingItem } from '../../(admin)/admin/today/data';
import { TodayView } from '../../(admin)/admin/today/view';

// A parent's day and My tasks (WP-12) with a made-up family and no database, for the UI suite: the
// pages' layout on a phone and a laptop, in Day and Evening (?theme=evening), and every state of a
// row. ?view=my for My tasks (with each item's reminder bell, WP-40), ?view=unlinked for a sign-in
// not linked to a member.
export const metadata: Metadata = { title: 'Admin day', robots: { index: false } };

const TZ = 'America/New_York';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const ALEX = 'f1000000-0000-4000-8000-000000000003';
const SAM = 'f1000000-0000-4000-8000-000000000004';
const PEOPLE = [
  { id: MAYA, displayName: 'Maya' },
  { id: LEO, displayName: 'Leo' },
  { id: ALEX, displayName: 'Alex' },
  { id: SAM, displayName: 'Sam' },
];

const shift = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function fixture(today: string) {
  let n = 0;
  const item = (o: Partial<DayItem>): DayItem => ({
    id: `e1000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    choreId: `c${n}`,
    title: 'Item',
    icon: 'list-check',
    kind: 'chore',
    dueDate: today,
    dueTime: null,
    memberId: null,
    assignees: [],
    status: 'scheduled',
    doneBy: [],
    points: 5,
    ...o,
  });
  const items = [
    item({
      title: 'Make bed',
      icon: 'chore-bed',
      dueTime: '07:30',
      memberId: MAYA,
      assignees: [MAYA],
      status: 'completed',
      doneBy: [MAYA],
    }),
    item({
      title: 'Make bed',
      icon: 'chore-bed',
      dueTime: '07:30',
      memberId: LEO,
      assignees: [LEO],
    }),
    item({
      title: 'Brush teeth',
      icon: 'chore-teeth',
      dueTime: '07:45',
      memberId: MAYA,
      assignees: [MAYA],
      status: 'approved',
      doneBy: [MAYA],
    }),
    item({ title: 'Feed the dog', icon: 'chore-pet', dueTime: '17:00', assignees: [ALEX, MAYA] }),
    item({
      title: 'Set the table',
      icon: 'chore-table',
      dueTime: '17:30',
      assignees: [LEO],
      status: 'completed',
      doneBy: [LEO],
    }),
    item({
      title: 'Take out the bins',
      icon: 'chore-bin',
      dueTime: '19:00',
      assignees: [ALEX],
      status: 'skipped',
    }),
    item({
      title: 'Return library books',
      icon: 'chore-read',
      kind: 'task',
      dueDate: shift(today, -3),
      assignees: [MAYA],
    }),
    item({
      title: 'Call the plumber',
      icon: 'calendar',
      kind: 'task',
      assignees: [ALEX],
      points: 0,
    }),
  ];
  const waiting: WaitingItem[] = [
    {
      ...item({
        title: 'Homework',
        icon: 'chore-homework',
        dueTime: '16:00',
        assignees: [MAYA],
        status: 'pending_approval',
        doneBy: [MAYA],
        points: 10,
      }),
      checkedAt: `${today}T20:10:00Z`,
      flagged: false,
    },
    {
      ...item({
        title: 'Practice piano',
        icon: 'list-check',
        dueDate: shift(today, -1),
        assignees: [LEO],
        status: 'pending_approval',
        doneBy: [LEO],
      }),
      checkedAt: `${today}T12:05:00Z`,
      flagged: true,
    },
  ];
  const mine = [
    item({
      title: 'Book the dentist',
      icon: 'calendar',
      kind: 'task',
      dueDate: shift(today, -2),
      assignees: [ALEX],
      points: 0,
    }),
    items[3]!,
    items[7]!,
    item({
      title: 'Pay the school trip fee',
      icon: 'buy',
      kind: 'task',
      dueDate: shift(today, 3),
      assignees: [ALEX],
      points: 0,
    }),
    item({
      title: 'Renew car insurance',
      icon: 'list-check',
      kind: 'task',
      status: 'completed',
      doneBy: [ALEX],
      assignees: [ALEX],
      points: 0,
    }),
  ];
  return { items, waiting, mine };
}

export default async function DevAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; view?: string; notice?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const today = isoDay(TZ);
  const { items, waiting, mine } = fixture(today);
  const request = 'a1000000-0000-4000-8000-000000000001';
  return (
    <div className={`admin ${theme}`}>
      {params.view === 'my' || params.view === 'unlinked' ? (
        <MyTasksView
          today={today}
          me={params.view === 'my' ? ALEX : null}
          // [D-61] Unlinked: the adults with no sign-in to choose from.
          candidates={[
            { id: ALEX, displayName: 'Alex', avatarKey: 'owl', color: 'member-1' },
            { id: SAM, displayName: 'Sam', avatarKey: 'bear', color: 'member-2' },
          ]}
          items={mine}
          people={PEOPLE}
          notice={params.notice ? 'Added Pick up the dry cleaning for today.' : null}
          error={null}
          request={request}
          // [CHR-16] The bell (WP-40): on by default; the second item switched off.
          bells={new Map(mine.map((i, n) => [i.choreId, n === 1 ? false : null]))}
          defaultOn
          remindersOn
        />
      ) : (
        <TodayView
          date={today}
          today={today}
          timezone={TZ}
          items={items}
          waiting={waiting}
          people={PEOPLE}
          notice={params.notice ? 'Unchecked 2 items. Their points are taken back.' : null}
          error={null}
          undoBatchId={params.notice ? 'b1000000-0000-4000-8000-000000000001' : null}
          request={request}
        />
      )}
    </div>
  );
}
