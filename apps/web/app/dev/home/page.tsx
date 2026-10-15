import type { Metadata } from 'next';
import { HomeView, type SchoolToday } from '../../(admin)/admin/home-view';
import { isoDay } from '@/lib/format';
import { type AlertFacts, homeAlerts } from '@/lib/home-alerts';
import { lunchQuickWords, lunchWeekToOpen } from '@/lib/lunch-list';

// [NFR-17][US-109] Home at a glance (WP-57) with the made-up family and no database, for the UI suite
// and the guide: Alex signed in; two check-offs and a reward request waiting, the Den board quiet,
// the School calendar failing, and no menu for next week. ?state=quiet for nothing to look at;
// ?school=off (today's snow day, with Undo), weekend, none (no school year); ?menus=none for no feed;
// ?lunch=none for no child with school lunch (WP-73); ?theme=evening; ?notice= one of Home's notices.
export const metadata: Metadata = { title: 'Home', robots: { index: false } };

const TZ = 'America/New_York';
/** The day the page says it is ("Tuesday, October 13"), for the lunch card's week (WP-73). */
const SHOWN = '2026-10-13';

export default async function DevHomePage({
  searchParams,
}: {
  searchParams: Promise<{
    theme?: string;
    state?: string;
    school?: string;
    menus?: string;
    lunch?: string;
    notice?: string;
  }>;
}) {
  const p = await searchParams;
  const theme = p.theme === 'evening' ? 'theme-evening' : 'theme-day';
  const today = isoDay(TZ);
  const now = new Date().toISOString();
  const ago = (minutes: number) => new Date(Date.parse(now) - minutes * 60_000).toISOString();
  const quiet = p.state === 'quiet';
  const facts: AlertFacts = {
    now,
    today,
    approvals: quiet ? 0 : 2,
    requests: quiet ? 0 : 1,
    boards: [
      { name: 'Kitchen', lastSeenAt: ago(2), revoked: false },
      { name: 'Den', lastSeenAt: quiet ? ago(3) : ago(3 * 24 * 60), revoked: false },
    ],
    calendars: [
      { name: 'Family', status: 'ok' },
      { name: 'School', status: quiet ? 'ok' : 'error' },
    ],
    menuFeeds: [{ name: 'Lunch', status: 'ok' }],
    jobsNeedingLook: 0,
    weather: { place: 'Springfield', failedAt: null },
    schoolYear: { name: '2026–27', startDate: '2026-09-02', endDate: '2027-06-18' },
    nextWeek: { school: true, menuDays: quiet ? 5 : 0 },
    hasMenus: true,
    invites: [],
  };
  const year = 'd1000000-0000-4000-8000-000000000001';
  const school: SchoolToday =
    p.school === 'off'
      ? {
          state: 'off',
          yearId: year,
          name: 'Snow day',
          snowDayId: 'd2000000-0000-4000-8000-000000000001',
        }
      : p.school === 'weekend'
        ? { state: 'weekend', yearId: year }
        : p.school === 'none'
          ? { state: 'none', yearId: null }
          : { state: 'school', yearId: year };
  return (
    <div className={`admin ${theme}`}>
      <HomeView
        name="The Rivera family"
        dateLine="Tuesday, October 13"
        alerts={homeAlerts(facts)}
        school={school}
        menuFeeds={p.menus === 'none' ? 0 : 1}
        lunch={
          p.lunch === 'none'
            ? null
            : {
                href: `/admin/meals?week=${lunchWeekToOpen(SHOWN)}#lunch`,
                words: lunchQuickWords(
                  [
                    { name: 'Maya', toPick: 1 },
                    { name: 'Leo', toPick: 0 },
                  ],
                  lunchWeekToOpen(SHOWN) > SHOWN,
                ),
              }
        }
        notice={p.notice ?? null}
        waiting={quiet ? 0 : 2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
