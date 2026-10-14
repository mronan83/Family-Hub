import type { Metadata } from 'next';
import type { DayItem } from '@/lib/admin-day';
import { isoDay } from '@/lib/format';
import { MyTasksView } from '../../(admin)/admin/my/view';
import type { WaitingItem } from '../../(admin)/admin/today/data';
import { TodayView } from '../../(admin)/admin/today/view';
import { WeatherSection } from '../../(admin)/admin/weather-section';
import type { LunchPick, WaitingLunch } from '@/lib/lunch';
import type { MenuItem } from '@/lib/menu/nutrislice';

// A parent's day and My tasks (WP-12) with a made-up family and no database, for the UI suite: the
// pages' layout on a phone and a laptop, in Day and Evening (?theme=evening), and every state of a
// row. ?view=my for My tasks (with each item's reminder bell, WP-40), ?view=unlinked for a sign-in
// not linked to a member. [BRD-04] ?view=weather for Weather on the boards (WP-45; in Family options since WP-57), with
// &state=none (no place yet), found (places to choose from), failing (the last read failed).
// [MEAL-09] ?lunches=1: the children's lunch changes from the board waiting on Today (WP-49).
export const metadata: Metadata = { title: 'Admin day', robots: { index: false } };

const TZ = 'America/New_York';
const MAYA = 'f1000000-0000-4000-8000-000000000001';
const LEO = 'f1000000-0000-4000-8000-000000000002';
const ALEX = 'f1000000-0000-4000-8000-000000000003';
const SAM = 'f1000000-0000-4000-8000-000000000004';
const PEOPLE = [
  { id: MAYA, displayName: 'Maya', avatarKey: 'fox' as const, color: 'member-3' as const },
  { id: LEO, displayName: 'Leo', avatarKey: 'frog' as const, color: 'member-4' as const },
  { id: ALEX, displayName: 'Alex' },
  { id: SAM, displayName: 'Sam' },
];

/**
 * [MEAL-09] Next week's lunch changes, made on the board on Sunday evening: Maya asks for Tuesday as
 * Buy with her picks and Thursday as Bring; Leo asks for Wednesday as Bring. Made-up menus.
 */
function lunchFixture(today: string): WaitingLunch[] {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = shift(today, (8 - dow) % 7 || 7);
  // As the database gives them: by section title, so the milk before the fruit; Today says them in
  // the menu's order (MEAL-11).
  const picks: LunchPick[] = [
    { section: 'Choice of Entree', options: [1], names: ['Cheese pizza'] },
    { section: 'Choice of Milk', options: [1], names: ['1% milk'] },
    {
      section: 'Fruits & Vegetables offered',
      options: [1, 2],
      names: ['Apple slices', 'Baby carrots'],
    },
  ];
  const menu: MenuItem[] = [
    { name: 'Cheese pizza', section: 'Choice of Entree', option: 1 },
    { name: 'Chicken wrap', section: 'Choice of Entree', option: 2 },
    { name: 'Apple slices', section: 'Fruits & Vegetables offered', option: 1 },
    { name: 'Baby carrots', section: 'Fruits & Vegetables offered', option: 2 },
    { name: '1% milk', section: 'Choice of Milk', option: 1 },
  ];
  const at = (h: number, m: number) =>
    `${shift(monday, -1)}T${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  return [
    {
      id: 'a2000000-0000-4000-8000-000000000003',
      memberId: LEO,
      date: shift(monday, 2),
      mode: 'bring',
      choices: [],
      current: 'buy',
      currentChoices: [],
      usual: 'buy',
      requestedAt: at(19, 9),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000001',
      memberId: MAYA,
      date: shift(monday, 1),
      mode: 'buy',
      choices: picks,
      menu,
      current: 'bring',
      currentChoices: [],
      usual: 'bring',
      requestedAt: at(19, 2),
    },
    {
      id: 'a2000000-0000-4000-8000-000000000002',
      memberId: MAYA,
      date: shift(monday, 3),
      mode: 'bring',
      choices: [],
      current: 'buy',
      currentChoices: picks.slice(0, 1),
      usual: 'buy',
      requestedAt: at(19, 4),
    },
  ];
}

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
  searchParams: Promise<{
    theme?: string;
    view?: string;
    notice?: string;
    state?: string;
    lunches?: string;
  }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const today = isoDay(TZ);
  const { items, waiting, mine } = fixture(today);
  const request = 'a1000000-0000-4000-8000-000000000001';
  return (
    <div className={`admin ${theme}`}>
      {params.view === 'weather' ? (
        <main className="fw-page fw-page--wide">
          <WeatherSection
            place={params.state === 'none' ? null : 'Springfield, Illinois, United States'}
            unit="fahrenheit"
            last={
              params.state === 'none'
                ? null
                : {
                    temperature: 54.3,
                    high: 61.2,
                    code: 2,
                    isDay: true,
                    unit: 'fahrenheit',
                    readAt: `${today}T14:09:00Z`,
                    failedAt: params.state === 'failing' ? `${today}T14:39:00Z` : null,
                    error:
                      params.state === 'failing'
                        ? 'The weather service answered 503 (Service Unavailable). FamilyWise tries again in 30 minutes.'
                        : null,
                  }
            }
            timezone={TZ}
            query={params.state === 'found' ? 'Springfield' : null}
            found={
              params.state === 'found'
                ? {
                    places: [
                      {
                        label: 'Springfield, Missouri, United States',
                        latitude: 37.22,
                        longitude: -93.3,
                      },
                      {
                        label: 'Springfield, Illinois, United States',
                        latitude: 39.8,
                        longitude: -89.64,
                      },
                      {
                        label: 'Springfield, Massachusetts, United States',
                        latitude: 42.1,
                        longitude: -72.59,
                      },
                    ],
                  }
                : null
            }
            notice={params.notice ? 'saved' : null}
          />
        </main>
      ) : params.view === 'my' || params.view === 'unlinked' ? (
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
          lunches={params.lunches === '1' ? lunchFixture(today) : []}
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
