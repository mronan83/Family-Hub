import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminHousehold, requireSignedIn } from '@/lib/auth/session';
import { addDays } from '@/lib/board-calendar';
import { isoDay } from '@/lib/format';
import { WINDOW_DAYS } from '@/lib/menu/import';
import { menuRefusal } from '@/lib/menus';
import { serverClient } from '@/lib/supabase/server';
import { loadMembers } from '../../members/data';
import { loadMenus } from './data';
import { MenusView } from './view';

export const metadata: Metadata = { title: 'School menus' };

const DID: Record<string, (p: Record<string, string | undefined>) => string> = {
  added: (p) => `Added ${p.name ?? 'the menu'}.`,
  added_fetched: (p) => `Added ${p.name ?? 'the menu'} and fetched its next four weeks.`,
  added_failed: (p) =>
    `Added ${p.name ?? 'the menu'}, but it didn’t fetch. See what went wrong below.`,
  fetched: (p) => `Fetched ${p.name ?? 'the menu'}.`,
  fetch_failed: (p) => `${p.name ?? 'The menu'} didn’t fetch. See what went wrong below.`,
  renamed: (p) => `Renamed to ${p.name ?? 'its new name'}.`,
  removed: (p) => `Removed ${p.name ?? 'the menu'}.`,
  loaded: (p) => `Loaded ${p.count ?? 'the'} ${p.count === '1' ? 'day' : 'days'} from the file.`,
  day: () => 'Saved the day. It’s yours now: the feed won’t replace it.',
  day_feed: () => 'That day goes back to Nutrislice’s menu at the next fetch.',
  day_cleared: () => 'Removed the day.',
};

/** [MENU-01..05] The household's school menus and their next four weeks (WP-27). */
export default async function MenusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const db = await serverClient();
  const user = await requireSignedIn(db, '/admin/meals/menus');
  const household = await adminHousehold(db!, user.userId);
  if (!household) redirect('/setup');
  const p = await searchParams;
  const today = isoDay(household.timezone);
  const [menus, members] = await Promise.all([
    loadMenus(db!, household.id, today, addDays(today, WINDOW_DAYS - 1)),
    loadMembers(db!, household.id),
  ]);
  const did = p.did ? DID[p.did]?.(p) : undefined;
  const failed = p.did?.endsWith('_failed') ?? false;
  return (
    <MenusView
      menus={menus}
      names={new Map(members.map((m) => [m.id, m.displayName]))}
      timezone={household.timezone}
      today={today}
      now={new Date().getTime()}
      open={p.open ?? null}
      notice={did && !failed ? did : null}
      error={
        p.error
          ? p.error === 'remove'
            ? 'That menu wasn’t removed. Try again in a moment.'
            : menuRefusal({ hint: p.error })
          : failed
            ? (did ?? null)
            : null
      }
    />
  );
}
