import type { Metadata } from 'next';
import { AdminHeader } from '../../(admin)/admin/header';
import { BoardsView } from '../../(admin)/admin/devices/view';
import { DEFAULT_LAYOUT } from '@/lib/board-layout';
import { localInstant } from '@/lib/board-sleep';

// [DEV-07][US-207][DEV-09][D-118] Boards (WP-91, WP-34) with the made-up family and no database, for the UI
// suite and the guide, as in the fold audit's mockup. It is Thursday 15 October 2026 at 7:42 am.
//   - Kitchen: awake (school nights 9:30 pm to 6:30 am, weekends 10:30 pm to 7:30 am, 15 minutes
//     untouched, missed only while awake), seen a minute ago, Automatic, Standard text, the
//     household's layout.
//   - Hallway tablet: asleep until 8 am, seen 7 hours ago, Always Day, Larger text, its own layout.
//   - Playroom: no set times, missed always, seen two days ago, so Home lists it as not seen.
//   - Two boards disconnected.
// ?theme=evening; ?open=kitchen|hallway|playroom|household|disconnected for a fold open as after a
// save there; ?notice=saved|error for Kitchen's sleep and wake notice after a save.
export const metadata: Metadata = { title: 'Boards', robots: { index: false } };

const TZ = 'America/New_York';
const NOW = localInstant(TZ, '2026-10-15', 7 * 60 + 42);
const iso = (ms: number) => new Date(ms).toISOString();
const CALENDARS = [
  { id: 'family', name: 'Family', color: 'member-1' },
  { id: 'school', name: 'School calendar', color: 'member-3' },
  { id: 'soccer', name: 'Maya’s soccer', color: 'member-6' },
];
// The calendars set to show on the boards.
const SHOWN = ['family', 'school'];
const BOARDS = [
  {
    id: 'kitchen',
    name: 'Kitchen',
    lastSeenAt: iso(NOW - 60_000),
    config: {
      sleep: {
        missed: 'awake',
        schedule: {
          school: { sleep: '21:30', wake: '06:30' },
          weekend: { sleep: '22:30', wake: '07:30' },
        },
        idle_minutes: 15,
      },
    },
    calendars: { own: false, shown: new Set(SHOWN) },
  },
  {
    id: 'hallway',
    name: 'Hallway tablet',
    lastSeenAt: iso(NOW - 7 * 3_600_000),
    config: {
      theme: 'day',
      text_size: 'larger',
      sleep: {
        missed: 'awake',
        schedule: {
          school: { sleep: '21:00', wake: '08:00' },
          weekend: { sleep: '21:00', wake: '08:00' },
        },
      },
      layout: {
        calendar: '7',
        cards: [
          { id: 'meals', show: true },
          { id: 'coming', show: true },
          { id: 'goals', show: true },
          { id: 'waiting', show: false },
        ],
        weather: false,
      },
    },
    calendars: { own: true, shown: new Set(['family']) },
  },
  {
    id: 'playroom',
    name: 'Playroom',
    lastSeenAt: iso(localInstant(TZ, '2026-10-13', 7 * 60 + 12)),
    config: null,
    calendars: { own: false, shown: new Set(SHOWN) },
  },
];
const DISCONNECTED = [
  { id: 'ipad', name: 'Old iPad', revokedAt: iso(localInstant(TZ, '2026-09-02', 18 * 60 + 5)) },
  { id: 'test', name: 'Test board', revokedAt: iso(localInstant(TZ, '2026-08-30', 10 * 60)) },
];

export default async function DevBoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; open?: string; notice?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const params =
    p.open === 'disconnected'
      ? { did: 'disconnected' }
      : {
          board: p.notice ? 'kitchen' : p.open,
          ...(p.notice === 'saved'
            ? { did: 'sleep' }
            : p.notice === 'error'
              ? { error: 'sleep' }
              : {}),
        };
  return (
    <div className={`admin ${theme}`}>
      <BoardsView
        header={
          <AdminHeader
            current="/admin/devices"
            waiting={2}
            who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
          />
        }
        boards={BOARDS}
        disconnected={DISCONNECTED}
        calendars={CALENDARS}
        householdLayout={DEFAULT_LAYOUT}
        now={NOW}
        timeZone={TZ}
        school={null}
        params={params}
      />
    </div>
  );
}
