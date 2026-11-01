import type { Metadata } from 'next';
import { HomeView, type SchoolToday } from '../../(admin)/admin/home-view';
import { isoDay } from '@/lib/format';
import { type AlertFacts, homeAlerts } from '@/lib/home-alerts';
import { lunchQuickWords, lunchWeekToOpen } from '@/lib/lunch-list';
import { groceriesData, homeGroceries } from '../groceries/fixture';
import { runningLowCount } from '@/lib/grocery-staples';

// [NFR-17][US-109] Home at a glance (WP-57) with the made-up family and no database, for the UI suite
// and the guide: Alex signed in; two check-offs and a reward request waiting, the Den board quiet,
// the School calendar failing, and no menu for next week. ?state=quiet for nothing to look at;
// ?school=off (today's snow day, with Undo), weekend, none (no school year); ?menus=none for no feed;
// ?lunch=none for no child with school lunch (WP-73); ?theme=evening; ?notice= one of Home's notices.
// [MEAL-27] The Groceries card (WP-112): ?groceries=empty, or added (the line after adding Ground beef
// 2 lb); ?typed= what is typed in its field ("2 lb ground beef", "olive oil", "1 onion"). [MEAL-29]
// WP-116's brands: ?brand= what is typed in the Brand field, its offers open; ?groceries=added-brand
// (the line after adding Milk with Kirkland). [MEAL-22] ?asks=1: two grocery asks wait (WP-107).
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
    groceries?: string;
    typed?: string;
    brand?: string;
    asks?: string;
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
    groceryAsks: p.asks === '1' ? 2 : 0,
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
  const g = homeGroceries(
    p.groceries === 'empty' ? 'empty' : p.groceries === 'added' ? 'added' : 'busy',
  );
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
        groceries={{
          open: g.items,
          categories: g.categories,
          stores: g.stores,
          brands: g.brands,
          past: g.past,
          learned: g.learned,
          preferredStoreId: g.preferredStoreId,
          // [MEAL-21] The demo family's staples on Sun, Oct 18 (WP-106): 3 running low.
          runningLow:
            p.groceries === 'empty' ? 0 : runningLowCount(groceriesData('busy'), '2026-10-18'),
        }}
        groceriesDev={{
          typed: p.typed,
          brand: p.brand,
          added:
            p.groceries === 'added'
              ? {
                  id: g.items[g.items.length - 1]!.id,
                  what: 'Ground beef 2 lb',
                  category: 'Meat & Seafood',
                  at: 0,
                }
              : p.groceries === 'added-brand'
                ? {
                    id: g.items.find((i) => i.name === 'Milk')!.id,
                    what: 'Milk · Kirkland ×3',
                    category: 'Dairy & Eggs',
                    at: 0,
                  }
                : undefined,
        }}
        notice={p.notice ?? null}
        waiting={quiet ? 0 : 2}
        who={{ name: 'Alex', avatarKey: 'owl', color: 'member-1' }}
      />
    </div>
  );
}
