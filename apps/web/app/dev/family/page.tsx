import type { Metadata } from 'next';
import { FamilyView } from '../../(admin)/admin/settings/family/view';
import { isoDay } from '@/lib/format';

// [ACC-08][US-110] Family options (WP-57) with the made-up family and no database, for the UI suite
// and the guide: the week, check-offs, the weather (Springfield, read this morning), the admins and an
// open invite. ?state=pending for a change to Monday waiting for next week; ?theme=evening;
// ?notice= one of its notices.
export const metadata: Metadata = { title: 'Family options', robots: { index: false } };

const TZ = 'America/New_York';

export default async function DevFamilyPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; state?: string; notice?: string }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const today = isoDay(TZ);
  return (
    <div className={`admin ${theme}`}>
      <FamilyView
        notice={p.notice ?? null}
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
            { userId: 'u1', email: 'alex@example.com', role: 'owner' },
            { userId: 'u2', email: 'sam@example.com', role: 'admin' },
          ],
          invites: [{ id: 'i1', email: 'grandma@example.com', expires: 'Oct 18' }],
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
            readAt: `${today}T14:09:00Z`,
            failedAt: null,
            error: null,
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
