import type { Metadata } from 'next';
import type { CalendarRow } from '@/lib/calendars';
import { CalendarsView } from '../../(admin)/admin/calendars/view';

// The household's calendars (WP-22) with made-up calendars and events and no database, for the UI
// suite: one synced with what's coming up (an all-day trip, a moved instance), one whose link fails
// with its last good sync kept, one not synced yet; on a phone and a laptop, in Day and Evening
// (?theme=evening). ?state=empty for a household with none yet.
export const metadata: Metadata = { title: 'Calendars', robots: { index: false } };

const MEMBERS = [
  { id: 'f1000000-0000-4000-8000-000000000001', displayName: 'Ava' },
  { id: 'f1000000-0000-4000-8000-000000000003', displayName: 'Alex' },
];

const CALENDARS: CalendarRow[] = [
  {
    id: 'c1000000-0000-4000-8000-000000000001',
    name: 'Family',
    color: 'member-6',
    memberId: null,
    showOnBoard: true,
    status: 'ok',
    lastSyncedAt: '2026-10-20T16:03:00Z',
    lastSuccessAt: '2026-10-20T16:03:00Z',
    lastError: null,
    upcomingCount: 23,
    upcoming: [
      {
        id: 'e1',
        title: 'Swim',
        allDay: false,
        start: '2026-10-20T21:00:00Z',
        end: '2026-10-20T22:00:00Z',
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        changed: false,
      },
      {
        id: 'e2',
        title: 'Field trip',
        allDay: true,
        start: '2026-10-23T04:00:00Z',
        end: '2026-10-24T04:00:00Z',
        startDate: '2026-10-23',
        endDate: '2026-10-23',
        changed: false,
      },
      {
        id: 'e3',
        title: 'Swim (Wednesday this week)',
        allDay: false,
        start: '2026-10-28T22:00:00Z',
        end: '2026-10-28T23:00:00Z',
        startDate: '2026-10-28',
        endDate: '2026-10-28',
        changed: true,
      },
      {
        id: 'e4',
        title: 'Grandparents visit',
        allDay: true,
        start: '2026-11-25T05:00:00Z',
        end: '2026-11-29T05:00:00Z',
        startDate: '2026-11-25',
        endDate: '2026-11-28',
        changed: false,
      },
    ],
  },
  {
    id: 'c1000000-0000-4000-8000-000000000002',
    name: 'Ava’s school',
    color: 'member-3',
    memberId: 'f1000000-0000-4000-8000-000000000001',
    showOnBoard: true,
    status: 'error',
    lastSyncedAt: '2026-10-20T16:03:00Z',
    lastSuccessAt: '2026-10-19T21:48:00Z',
    lastError:
      'The link answered 404 (Not Found): the calendar may no longer be public. Share it publicly again in Apple Calendar and replace the link.',
    upcomingCount: 2,
    upcoming: [
      {
        id: 'e5',
        title: 'Picture day',
        allDay: true,
        start: '2026-10-22T04:00:00Z',
        end: '2026-10-23T04:00:00Z',
        startDate: '2026-10-22',
        endDate: '2026-10-22',
        changed: false,
      },
      {
        id: 'e6',
        title: 'Parent evening',
        allDay: false,
        start: '2026-10-29T22:30:00Z',
        end: '2026-10-30T00:00:00Z',
        startDate: '2026-10-29',
        endDate: '2026-10-29',
        changed: false,
      },
    ],
  },
  {
    id: 'c1000000-0000-4000-8000-000000000003',
    name: 'Work',
    color: 'member-1',
    memberId: 'f1000000-0000-4000-8000-000000000003',
    showOnBoard: false,
    status: 'pending',
    lastSyncedAt: null,
    lastSuccessAt: null,
    lastError: null,
    upcomingCount: 0,
    upcoming: [],
  },
];

export default async function DevCalendarsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string }>;
}) {
  const params = await searchParams;
  const theme = params.theme === 'evening' ? 'theme-evening' : 'theme-day';
  return (
    <div className={`admin ${theme}`}>
      <CalendarsView
        calendars={params.state === 'empty' ? [] : CALENDARS}
        members={MEMBERS}
        timezone="America/New_York"
        notice={params.state === 'empty' ? null : 'Added Family and synced it.'}
        error={null}
      />
    </div>
  );
}
