import type { Metadata } from 'next';
import { type FamilySection, FamilyView } from '../../(admin)/admin/settings/family/view';

// [ACC-08][US-110] Family options (WP-57) with the made-up family and no database, for the UI suite
// and the guide: the week, check-offs, the weather (Springfield, read this morning), the admins and an
// open invite. ?state=pending for a change to Monday waiting for next week; ?theme=evening;
// ?notice= one of its notices. [NFR-18] Every section folded (WP-94): ?open= one of them open, as after
// a save in it (week, check-offs, weather or invite); ?weather=failing for a failed read on the
// weather's header. Thursday, Oct 15, 2026 at 2:45 pm.
export const metadata: Metadata = { title: 'Family options', robots: { index: false } };

const TZ = 'America/New_York';
/** Thursday, Oct 15, 2026 at 2:45 pm in the family's zone. */
const NOW = new Date('2026-10-15T18:45:00Z');

export default async function DevFamilyPage({
  searchParams,
}: {
  searchParams: Promise<{
    theme?: string;
    state?: string;
    notice?: string;
    open?: string;
    weather?: string;
  }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const failing = p.weather === 'failing';
  const open = (['week', 'check-offs', 'weather', 'invite'] as FamilySection[]).find(
    (s) => s === p.open,
  );
  return (
    <div className={`admin ${theme}`}>
      <FamilyView
        notice={p.notice ?? null}
        open={open ?? null}
        now={NOW}
        waiting={2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
        facts={{
          name: 'The Rivera family',
          timezone: TZ,
          email: 'alex@example.com',
          weekStart: 0,
          weekStartNext: p.state === 'pending' ? { day: 1, on: '2026-10-19' } : null,
          approvalMode: 'off',
          admins: [
            { userId: 'u1', email: 'alex@example.com', name: 'Alex', role: 'owner' },
            { userId: 'u2', email: 'sam@example.com', name: 'Sam', role: 'admin' },
          ],
          invites: [
            {
              id: 'i1',
              email: 'grandma@example.com',
              expires: 'Sat, Oct 17',
              expiresAt: '2026-10-17T20:00:00Z',
            },
          ],
        }}
        weather={{
          place: 'Springfield, Illinois, United States',
          unit: 'fahrenheit',
          last: {
            temperature: 54.3,
            high: 61.2,
            code: 2,
            isDay: true,
            unit: 'fahrenheit',
            readAt: '2026-10-15T18:10:00Z',
            failedAt: failing ? '2026-10-15T18:40:00Z' : null,
            error: failing ? 'Open-Meteo couldn’t be reached.' : null,
          },
          timezone: TZ,
          query: null,
          found: null,
          notice: null,
        }}
      />
    </div>
  );
}
