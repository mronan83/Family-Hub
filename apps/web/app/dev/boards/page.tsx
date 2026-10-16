import type { Metadata } from 'next';
import { AdminHeader } from '../../(admin)/admin/header';
import { SleepForm, SleepStatus } from '../../(admin)/admin/devices/sleep-form';
import { localInstant, readBoardSleep } from '@/lib/board-sleep';
import { dayAndTime } from '@/lib/format';
import { KITCHEN_SLEEP } from '../board/fixture';

// [DEV-07][US-207] Boards' sleep and wake (WP-34) with the made-up family and no database,
// for the UI suite and the guide, as in the mockup: Kitchen (school nights 9:30 pm to 6:30 am,
// weekends 10:30 pm to 7:30 am, 15 minutes untouched, missed only while awake) with its section open,
// and Playroom (never missed, 10 minutes untouched). It is Thursday 15 October 2026 at 7:42 am.
// ?theme=evening; ?notice=saved|error for the notice after a save.
export const metadata: Metadata = { title: 'Boards', robots: { index: false } };

const TZ = 'America/New_York';
const NOW = localInstant(TZ, '2026-10-15', 7 * 60 + 42);
const BOARDS = [
  { id: 'kitchen', name: 'Kitchen', seen: NOW, sleep: KITCHEN_SLEEP },
  {
    id: 'playroom',
    name: 'Playroom',
    seen: NOW - 14 * 3_600_000,
    sleep: readBoardSleep({ missed: 'never', idle_minutes: 10 }),
  },
];

export default async function DevBoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; notice?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const notice = p.notice === 'saved' || p.notice === 'error' ? p.notice : null;
  return (
    <div className={`admin ${theme}`}>
      <main className="fw-page fw-page--wide">
        <AdminHeader
          current="/admin/devices"
          waiting={2}
          who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
        />
        <section className="fw-card" aria-labelledby="boards-heading">
          <h1 id="boards-heading">Boards</h1>
          <ul className="fw-list" aria-label="Paired boards">
            {BOARDS.map((b) => (
              <li key={b.id} className="fw-list__row">
                <span>
                  <strong>{b.name}</strong>
                  <span className="fw-muted"> · Last seen {dayAndTime(new Date(b.seen), TZ)}</span>
                  <SleepStatus sleep={b.sleep} now={NOW} timeZone={TZ} school={null} />
                </span>
                <SleepForm
                  device={b.id}
                  name={b.name}
                  sleep={b.sleep}
                  open={b.id === 'kitchen'}
                  notice={b.id === 'kitchen' ? notice : null}
                />
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
